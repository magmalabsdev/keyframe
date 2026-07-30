import { describe, it, expect } from 'vitest';
import {
  clipsOverlap,
  MIN_FRAGMENT_MS,
  normalizeAudioOverlaps,
  resolveOverlaps,
} from './audioOverlap';
import type { AudioClip } from './types';

function clip(partial: Partial<AudioClip> & { id: string }): AudioClip {
  return {
    name: partial.id,
    mediaId: 'm1',
    startMs: 0,
    offsetMs: 0,
    durationMs: 1000,
    sourceDurationMs: 10000,
    gain: 1,
    loop: false,
    ...partial,
  };
}

describe('clipsOverlap', () => {
  it('is true for genuine intersections', () => {
    expect(clipsOverlap(0, 100, 50, 150)).toBe(true);
    expect(clipsOverlap(50, 150, 0, 100)).toBe(true);
    expect(clipsOverlap(0, 100, 10, 20)).toBe(true); // contained
    expect(clipsOverlap(10, 20, 0, 100)).toBe(true); // containing
  });

  it('is false for butt-joined ranges (half-open)', () => {
    expect(clipsOverlap(0, 100, 100, 200)).toBe(false);
    expect(clipsOverlap(100, 200, 0, 100)).toBe(false);
  });

  it('is false for disjoint ranges', () => {
    expect(clipsOverlap(0, 100, 500, 600)).toBe(false);
  });
});

describe('resolveOverlaps', () => {
  const moved = (startMs: number, durationMs: number) => ({ id: 'M', startMs, durationMs });

  it('returns an empty resolution when nothing overlaps', () => {
    const others = [clip({ id: 'a', startMs: 2000, durationMs: 500 })];
    expect(resolveOverlaps(moved(0, 1000), others)).toEqual({
      removeIds: [],
      updates: [],
      inserts: [],
    });
  });

  it('treats butt-joined neighbours as no conflict', () => {
    const others = [clip({ id: 'a', startMs: 1000, durationMs: 500 })];
    const r = resolveOverlaps(moved(0, 1000), others);
    expect(r.removeIds).toEqual([]);
    expect(r.updates).toEqual([]);
  });

  it('removes a fully covered clip, including equal-edge boundaries', () => {
    const others = [clip({ id: 'a', startMs: 200, durationMs: 300 })];
    expect(resolveOverlaps(moved(0, 1000), others).removeIds).toEqual(['a']);
    // Exactly coincident spans also count as covered.
    const exact = [clip({ id: 'b', startMs: 0, durationMs: 1000 })];
    expect(resolveOverlaps(moved(0, 1000), exact).removeIds).toEqual(['b']);
  });

  it('right-truncates an incumbent, leaving offsetMs untouched', () => {
    // a: 0-1000 (offset 200); moved covers 600-2000 -> a keeps 0-600.
    const others = [clip({ id: 'a', startMs: 0, durationMs: 1000, offsetMs: 200 })];
    const r = resolveOverlaps(moved(600, 1400), others);
    expect(r.removeIds).toEqual([]);
    expect(r.updates).toEqual([{ id: 'a', startMs: 0, offsetMs: 200, durationMs: 600 }]);
  });

  it('left-truncates an incumbent, advancing offsetMs by the trimmed amount', () => {
    // a: 1000-2000 (offset 200); moved covers 0-1400 -> a keeps 1400-2000.
    const others = [clip({ id: 'a', startMs: 1000, durationMs: 1000, offsetMs: 200 })];
    const r = resolveOverlaps(moved(0, 1400), others);
    expect(r.updates).toEqual([
      { id: 'a', startMs: 1400, offsetMs: 200 + 400, durationMs: 600 },
    ]);
  });

  it('splits an incumbent the moved clip lands strictly inside', () => {
    // a: 0-3000 (offset 500); moved covers 1000-2000.
    const a = clip({ id: 'a', startMs: 0, durationMs: 3000, offsetMs: 500 });
    const r = resolveOverlaps(moved(1000, 1000), [a]);
    expect(r.removeIds).toEqual([]);
    expect(r.updates).toEqual([{ id: 'a', startMs: 0, offsetMs: 500, durationMs: 1000 }]);
    expect(r.inserts).toEqual([
      { sourceId: 'a', startMs: 2000, offsetMs: 500 + 2000, durationMs: 1000 },
    ]);
    // Both fragments stay inside the source.
    for (const piece of [...r.updates, ...r.inserts]) {
      expect(piece.offsetMs + piece.durationMs).toBeLessThanOrEqual(a.sourceDurationMs);
    }
  });

  it('wraps offsetMs for a looping clip on left-truncate', () => {
    const a = clip({
      id: 'a',
      startMs: 1000,
      durationMs: 1000,
      offsetMs: 900,
      sourceDurationMs: 1000,
      loop: true,
    });
    const r = resolveOverlaps(moved(0, 1400), [a]);
    // 900 + 400 = 1300, wrapped modulo 1000 -> 300.
    expect(r.updates[0].offsetMs).toBe(300);
  });

  it('drops a sliver instead of leaving a zero-length clip', () => {
    // a: 0-1000; moved covers from just after a's start, so a's surviving head
    // is only MIN_FRAGMENT_MS/2 long and must be discarded rather than kept.
    const others = [clip({ id: 'a', startMs: 0, durationMs: 1000 })];
    const r = resolveOverlaps(moved(MIN_FRAGMENT_MS / 2, 2000), others);
    expect(r.removeIds).toEqual(['a']);
    expect(r.updates).toEqual([]);
  });

  it('keeps a head that is exactly the minimum fragment length', () => {
    const others = [clip({ id: 'a', startMs: 0, durationMs: 1000 })];
    const r = resolveOverlaps(moved(MIN_FRAGMENT_MS, 2000), others);
    expect(r.removeIds).toEqual([]);
    expect(r.updates).toEqual([
      { id: 'a', startMs: 0, offsetMs: 0, durationMs: MIN_FRAGMENT_MS },
    ]);
  });

  it('on a split with a sliver head, removes the incumbent but keeps the tail', () => {
    const a = clip({ id: 'a', startMs: 0, durationMs: 3000, offsetMs: 0 });
    const r = resolveOverlaps(moved(MIN_FRAGMENT_MS / 2, 1000), [a]);
    expect(r.removeIds).toEqual(['a']);
    expect(r.updates).toEqual([]);
    expect(r.inserts).toHaveLength(1);
    // An id must never be in both updates and removeIds.
    const updatedIds = r.updates.map((u) => u.id);
    expect(updatedIds.some((id) => r.removeIds.includes(id))).toBe(false);
  });

  it('clears several neighbours at once', () => {
    const others = [
      clip({ id: 'a', startMs: 0, durationMs: 200 }),
      clip({ id: 'b', startMs: 300, durationMs: 200 }),
      clip({ id: 'c', startMs: 600, durationMs: 200 }),
      clip({ id: 'd', startMs: 5000, durationMs: 200 }), // untouched
    ];
    const r = resolveOverlaps(moved(0, 1000), others);
    expect(r.removeIds.sort()).toEqual(['a', 'b', 'c']);
    expect(r.updates).toEqual([]);
  });

  it('ignores the moved clip itself if present in others', () => {
    const others = [clip({ id: 'M', startMs: 0, durationMs: 1000 })];
    expect(resolveOverlaps(moved(0, 1000), others).removeIds).toEqual([]);
  });
});

describe('normalizeAudioOverlaps', () => {
  const spans = (cs: AudioClip[]) => cs.map((c) => [c.startMs, c.startMs + c.durationMs]);

  it('leaves an already-valid track untouched', () => {
    const cs = [
      clip({ id: 'a', startMs: 0, durationMs: 500 }),
      clip({ id: 'b', startMs: 500, durationMs: 500 }),
    ];
    expect(normalizeAudioOverlaps(cs)).toEqual(cs);
  });

  it('left-truncates a later clip that overlaps an earlier one (earlier wins)', () => {
    const cs = [
      clip({ id: 'a', startMs: 0, durationMs: 1000 }),
      clip({ id: 'b', startMs: 600, durationMs: 1000, offsetMs: 100 }),
    ];
    const out = normalizeAudioOverlaps(cs);
    expect(spans(out)).toEqual([
      [0, 1000],
      [1000, 1600],
    ]);
    expect(out[1].offsetMs).toBe(100 + 400);
  });

  it('drops a clip entirely swallowed by an earlier one', () => {
    const cs = [
      clip({ id: 'a', startMs: 0, durationMs: 2000 }),
      clip({ id: 'b', startMs: 500, durationMs: 500 }),
    ];
    const out = normalizeAudioOverlaps(cs);
    expect(out.map((c) => c.id)).toEqual(['a']);
  });

  it('resolves a chain of overlaps into a sorted non-overlapping run', () => {
    const cs = [
      clip({ id: 'c', startMs: 800, durationMs: 1000 }),
      clip({ id: 'a', startMs: 0, durationMs: 1000 }),
      clip({ id: 'b', startMs: 400, durationMs: 1000 }),
    ];
    const out = normalizeAudioOverlaps(cs);
    for (let i = 1; i < out.length; i++) {
      const prevEnd = out[i - 1].startMs + out[i - 1].durationMs;
      expect(out[i].startMs).toBeGreaterThanOrEqual(prevEnd);
    }
    expect(out.map((c) => c.startMs)).toEqual([...out.map((c) => c.startMs)].sort((x, y) => x - y));
  });
});

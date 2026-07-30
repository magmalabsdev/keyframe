import { describe, it, expect } from 'vitest';
import { ctxTimeFor, forwardClipWindow } from './forwardSchedule';

const clip = (partial: Partial<Parameters<typeof forwardClipWindow>[0]> = {}) => ({
  startMs: 1000,
  offsetMs: 0,
  durationMs: 2000,
  sourceDurationMs: 10000,
  loop: false,
  ...partial,
});

describe('forwardClipWindow', () => {
  it('returns null for a clip entirely behind the playhead', () => {
    expect(forwardClipWindow(clip({ startMs: 0, durationMs: 500 }), 1000)).toBeNull();
  });

  it('returns null when the clip ends exactly at the playhead (half-open)', () => {
    expect(forwardClipWindow(clip({ startMs: 0, durationMs: 1000 }), 1000)).toBeNull();
  });

  it('delays a clip that starts after the playhead, reading from its trim-in', () => {
    const w = forwardClipWindow(clip({ startMs: 1000, offsetMs: 250, durationMs: 2000 }), 400)!;
    expect(w.delaySec).toBeCloseTo(0.6, 9); // 1000 - 400
    expect(w.offsetSec).toBeCloseTo(0.25, 9); // offsetMs only; not into the clip yet
    expect(w.durationSec).toBeCloseTo(2, 9);
  });

  it('starts immediately and mid-source when the playhead is inside the clip', () => {
    const w = forwardClipWindow(clip({ startMs: 1000, offsetMs: 250, durationMs: 2000 }), 1500)!;
    expect(w.delaySec).toBe(0);
    expect(w.offsetSec).toBeCloseTo(0.75, 9); // 250 + (1500 - 1000)
    expect(w.durationSec).toBeCloseTo(1.5, 9); // 3000 - 1500
  });

  it('handles the playhead exactly at the clip start', () => {
    const w = forwardClipWindow(clip({ startMs: 1000, offsetMs: 100 }), 1000)!;
    expect(w.delaySec).toBe(0);
    expect(w.offsetSec).toBeCloseTo(0.1, 9);
    expect(w.durationSec).toBeCloseTo(2, 9);
  });

  it('wraps a looping clip past the end of its remaining source', () => {
    // offset 800, source 1000 => 200ms of source remains, so 500ms in wraps to 100.
    const w = forwardClipWindow(
      clip({ startMs: 0, offsetMs: 800, durationMs: 5000, sourceDurationMs: 1000, loop: true }),
      500,
    )!;
    expect(w.offsetSec).toBeCloseTo((800 + 100) / 1000, 9);
  });

  it('does not divide by zero when a looping clip has no source left', () => {
    const w = forwardClipWindow(
      clip({ startMs: 0, offsetMs: 1000, durationMs: 5000, sourceDurationMs: 1000, loop: true }),
      500,
    )!;
    expect(Number.isNaN(w.offsetSec)).toBe(false);
    expect(w.offsetSec).toBeCloseTo(1.5, 9); // unwrapped: offset + intoClip
  });
});

describe('ctxTimeFor', () => {
  const anchor = { ctxTime: 10, playheadMs: 2000 };

  it('maps forward playback at 1x onto real seconds', () => {
    expect(ctxTimeFor(anchor, 2000, 1)).toBeCloseTo(10, 9);
    expect(ctxTimeFor(anchor, 3000, 1)).toBeCloseTo(11, 9);
  });

  it('compresses time at faster rates', () => {
    expect(ctxTimeFor(anchor, 4000, 2)).toBeCloseTo(11, 9); // 2s of timeline in 1s
  });

  it('reproduces the reverse formula for negative rates', () => {
    // Going backward at 2x, reaching 1000ms (1s earlier) takes 0.5s.
    expect(ctxTimeFor(anchor, 1000, -2)).toBeCloseTo(10.5, 9);
    expect(ctxTimeFor(anchor, 1000, -1)).toBeCloseTo(11, 9);
  });
});

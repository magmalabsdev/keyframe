import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveScene, useDocumentStore } from './documentStore';
import { createDefaultProject } from './defaults';
import type { AudioClip } from './types';

const api = () => useDocumentStore.getState();
const tracks = () => getActiveScene(api().project).audioTracks;

function clip(partial: Partial<AudioClip> = {}): AudioClip {
  return {
    id: `clip-${Math.random().toString(36).slice(2)}`,
    name: 'clip',
    mediaId: 'm1',
    startMs: 0,
    offsetMs: 0,
    durationMs: 1000,
    sourceDurationMs: 3000,
    gain: 1,
    loop: false,
    ...partial,
  };
}

describe('documentStore audio actions', () => {
  beforeEach(() => {
    api().setProject(createDefaultProject());
  });

  it('adds and removes audio tracks on the active scene', () => {
    api().addAudioTrack('Music');
    expect(tracks()).toHaveLength(1);
    expect(tracks()[0].name).toBe('Music');
    const id = tracks()[0].id;
    api().removeAudioTrack(id);
    expect(tracks()).toHaveLength(0);
  });

  it('keeps clips sorted by start time when adding and moving', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'a', startMs: 2000 }));
    api().addAudioClip(t, clip({ id: 'b', startMs: 500 }));
    expect(tracks()[0].clips.map((c) => c.id)).toEqual(['b', 'a']);

    api().setAudioClipTime(t, 'b', 5000);
    expect(tracks()[0].clips.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('clamps a right-edge trim to the remaining source length', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'a', offsetMs: 500, sourceDurationMs: 3000 }));
    // Ask for a huge duration; a non-looping clip can't exceed source - offset.
    api().setAudioClipRange(t, 'a', { offsetMs: 500, durationMs: 999999 });
    expect(tracks()[0].clips[0].durationMs).toBe(2500);
  });

  it('clamps offset within the source and never negative', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'a', sourceDurationMs: 3000 }));
    api().setAudioClipRange(t, 'a', { startMs: -100, offsetMs: -200, durationMs: 1000 });
    const c = tracks()[0].clips[0];
    expect(c.startMs).toBe(0);
    expect(c.offsetMs).toBe(0);
  });

  it('moves a clip from one track to another', () => {
    api().addAudioTrack('A');
    api().addAudioTrack('B');
    const [a, b] = tracks().map((t) => t.id);
    api().addAudioClip(a, clip({ id: 'x', startMs: 1000 }));
    api().moveAudioClipToTrack(a, 'x', b);
    expect(tracks().find((t) => t.id === a)!.clips).toHaveLength(0);
    expect(tracks().find((t) => t.id === b)!.clips.map((c) => c.id)).toEqual(['x']);
  });

  /** Asserts the no-overlap invariant across every track of the active scene. */
  function expectNoOverlaps() {
    for (const t of tracks()) {
      const sorted = [...t.clips].sort((a, b) => a.startMs - b.startMs);
      expect(t.clips.map((c) => c.id)).toEqual(sorted.map((c) => c.id));
      for (let i = 1; i < t.clips.length; i++) {
        const prevEnd = t.clips[i - 1].startMs + t.clips[i - 1].durationMs;
        expect(t.clips[i].startMs).toBeGreaterThanOrEqual(prevEnd);
      }
    }
  }

  it('moveAudioClipResolved splits a clip it lands strictly inside', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'big', startMs: 0, durationMs: 3000, offsetMs: 500 }));
    api().addAudioClip(t, clip({ id: 'small', startMs: 5000, durationMs: 1000 }));

    api().moveAudioClipResolved(t, 'small', 1000);

    const clips = tracks()[0].clips;
    expect(clips).toHaveLength(3);
    const head = clips.find((c) => c.id === 'big')!;
    const moved = clips.find((c) => c.id === 'small')!;
    const tail = clips.find((c) => c.id !== 'big' && c.id !== 'small')!;
    expect(head).toMatchObject({ startMs: 0, offsetMs: 500, durationMs: 1000 });
    expect(moved).toMatchObject({ startMs: 1000, durationMs: 1000 });
    expect(tail).toMatchObject({ startMs: 2000, offsetMs: 500 + 2000, durationMs: 1000 });
    expectNoOverlaps();
  });

  it('moveAudioClipResolved is a single undo step even when it splits', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'big', startMs: 0, durationMs: 3000 }));
    api().addAudioClip(t, clip({ id: 'small', startMs: 5000, durationMs: 1000 }));

    const before = useDocumentStore.temporal.getState().pastStates.length;
    api().moveAudioClipResolved(t, 'small', 1000);
    expect(useDocumentStore.temporal.getState().pastStates.length).toBe(before + 1);
    expect(tracks()[0].clips).toHaveLength(3);

    useDocumentStore.temporal.getState().undo();
    const restored = tracks()[0].clips;
    expect(restored).toHaveLength(2);
    expect(restored.find((c) => c.id === 'big')!.durationMs).toBe(3000);
    expect(restored.find((c) => c.id === 'small')!.startMs).toBe(5000);
  });

  it('moveAudioClipResolved removes a fully covered clip', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'victim', startMs: 1000, durationMs: 200 }));
    api().addAudioClip(t, clip({ id: 'mover', startMs: 5000, durationMs: 1000 }));
    api().moveAudioClipResolved(t, 'mover', 800);
    expect(tracks()[0].clips.map((c) => c.id)).toEqual(['mover']);
    expectNoOverlaps();
  });

  it('addAudioClip resolves onto an occupied slot (import at the playhead)', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'a', startMs: 0, durationMs: 1000 }));
    api().addAudioClip(t, clip({ id: 'b', startMs: 500, durationMs: 1000 }));
    // b wins; a is right-truncated to end where b starts.
    expect(tracks()[0].clips.find((c) => c.id === 'a')!.durationMs).toBe(500);
    expectNoOverlaps();
  });

  it('setAudioClipRange stops a left-edge trim at the previous clip, shifting offsetMs with it', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'a', startMs: 0, durationMs: 1000 }));
    // offsetMs 1500 means b has 1500ms of source available to its left.
    api().addAudioClip(t, clip({ id: 'b', startMs: 2000, durationMs: 1000, offsetMs: 1500 }));

    // Drag b's left edge back to 500 (delta -1500, legal for the source) — it
    // must stop at a's end (1000) instead of growing over a.
    api().setAudioClipRange(t, 'b', { startMs: 500, offsetMs: 0, durationMs: 2500 });
    const b = tracks()[0].clips.find((c) => c.id === 'b')!;
    expect(b.startMs).toBe(1000);
    // requestedStart 500 clamped to 1000 => shift +500, so offset/duration follow
    // and the audible content stays put under the edge.
    expect(b.offsetMs).toBe(500);
    expect(b.durationMs).toBe(2000);
    expectNoOverlaps();
  });

  it('setAudioClipRange stops a right-edge trim at the next clip, even when looping', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().addAudioClip(t, clip({ id: 'a', startMs: 0, durationMs: 500, loop: true }));
    api().addAudioClip(t, clip({ id: 'b', startMs: 2000, durationMs: 500 }));

    // A looping clip previously had maxDur = Infinity, so this grew through b.
    api().setAudioClipRange(t, 'a', { offsetMs: 0, durationMs: 99999 });
    expect(tracks()[0].clips.find((c) => c.id === 'a')!.durationMs).toBe(2000);
    expectNoOverlaps();
  });

  it('toggles mute and gain on a track', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().setAudioTrackMuted(t, true);
    api().setAudioTrackGain(t, 2); // clamped to 1
    expect(tracks()[0].muted).toBe(true);
    expect(tracks()[0].gain).toBe(1);
  });
});

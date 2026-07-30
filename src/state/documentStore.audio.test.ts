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

  it('toggles mute and gain on a track', () => {
    api().addAudioTrack();
    const t = tracks()[0].id;
    api().setAudioTrackMuted(t, true);
    api().setAudioTrackGain(t, 2); // clamped to 1
    expect(tracks()[0].muted).toBe(true);
    expect(tracks()[0].gain).toBe(1);
  });
});

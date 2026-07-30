import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveScene, useDocumentStore } from './documentStore';
import { createDefaultProject } from './defaults';
import type { AudioClip, SceneObject, Tracks } from './types';

const api = () => useDocumentStore.getState();
const scene = () => getActiveScene(api().project);
const pastLength = () => useDocumentStore.temporal.getState().pastStates.length;

function obj(partial: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'o',
    name: 'o',
    type: 'mesh',
    parentId: null,
    assetId: 'a',
    visible: true,
    lifetime: { startMs: 0, endMs: 1000 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#fff', opacity: 1, metalness: 0, roughness: 1 },
    ...partial,
  };
}

const kf = (timeMs: number, value: number | string = 0) => ({
  id: `k${timeMs}`,
  timeMs,
  value,
  interpolation: 'linear' as const,
});

function clip(partial: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'clip-a',
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

/** Loads a fresh project whose active scene's objects are exactly `objects`
 * (no default light) — state is frozen once set, so this must replace the
 * array before `setProject`, not mutate afterward. */
function setup(objects: SceneObject[]): void {
  const project = createDefaultProject();
  project.scenes[0].objects = objects;
  api().setProject(project);
}

describe('splitAtPlayhead', () => {
  beforeEach(() => {
    useDocumentStore.temporal.getState().clear();
  });

  it('splits the single selected object at the playhead, partitioning keyframes', () => {
    setup([
      obj({
        id: 'a',
        lifetime: { startMs: 0, endMs: 1000 },
        tracks: { opacity: [kf(100), kf(400), kf(500), kf(900)] } as Tracks,
      }),
    ]);

    api().splitAtPlayhead(500, ['a']);

    const objects = scene().objects;
    expect(objects).toHaveLength(2);
    const original = objects.find((o) => o.id === 'a')!;
    const clone = objects.find((o) => o.id !== 'a')!;
    expect(original.lifetime).toEqual({ startMs: 0, endMs: 500 });
    expect(clone.lifetime).toEqual({ startMs: 500, endMs: 1000 });
    expect(original.tracks.opacity?.map((k) => k.timeMs)).toEqual([100, 400]);
    // timeMs === playheadMs (500) goes to the clone, per the ">=" boundary rule.
    expect(clone.tracks.opacity?.map((k) => k.timeMs)).toEqual([500, 900]);
    // Fresh ids on the clone's keyframes, no collision with the original's.
    expect(clone.tracks.opacity?.every((k) => k.id !== 'k500' && k.id !== 'k900')).toBe(true);
  });

  it('is a single undo step regardless of how many clips split', () => {
    setup([
      obj({ id: 'a', lifetime: { startMs: 0, endMs: 1000 } }),
      obj({ id: 'b', lifetime: { startMs: 0, endMs: 1000 } }),
    ]);
    const before = pastLength();
    api().splitAtPlayhead(500, []);
    expect(pastLength()).toBe(before + 1);
    expect(scene().objects).toHaveLength(4);
  });

  it('batch case splits every object AND every audio clip spanning the playhead', () => {
    setup([
      obj({ id: 'a', lifetime: { startMs: 0, endMs: 1000 } }),
      obj({ id: 'b', lifetime: { startMs: 2000, endMs: 3000 } }), // outside playhead span
    ]);
    api().addAudioTrack('t1');
    const trackId = scene().audioTracks[0].id;
    api().addAudioClip(trackId, clip({ id: 'c1', startMs: 0, durationMs: 1000, offsetMs: 200 }));

    api().splitAtPlayhead(500, []);

    expect(scene().objects).toHaveLength(3); // a split into 2, b untouched
    expect(scene().objects.find((o) => o.id === 'b')!.lifetime).toEqual({
      startMs: 2000,
      endMs: 3000,
    });

    const clips = scene().audioTracks[0].clips;
    expect(clips).toHaveLength(2);
    const first = clips.find((c) => c.id === 'c1')!;
    const second = clips.find((c) => c.id !== 'c1')!;
    expect(first.durationMs).toBe(500);
    expect(second.startMs).toBe(500);
    expect(second.offsetMs).toBe(700); // original offset(200) + firstDur(500)
    expect(second.durationMs).toBe(500);
    // Sum of durations equals the original.
    expect(first.durationMs + second.durationMs).toBe(1000);
  });

  it('does not split an audio clip when a single object is selected', () => {
    setup([obj({ id: 'a', lifetime: { startMs: 0, endMs: 1000 } })]);
    api().addAudioTrack('t1');
    const trackId = scene().audioTracks[0].id;
    api().addAudioClip(trackId, clip({ id: 'c1', startMs: 0, durationMs: 1000 }));

    api().splitAtPlayhead(500, ['a']);

    expect(scene().audioTracks[0].clips).toHaveLength(1);
    expect(scene().objects).toHaveLength(2); // only the object split
  });

  it('skips an object that has children of its own (a group), but still splits leaf children and other leaf objects', () => {
    setup([
      obj({ id: 'parent', lifetime: { startMs: 0, endMs: 1000 } }),
      obj({ id: 'child', parentId: 'parent', lifetime: { startMs: 0, endMs: 1000 } }),
      obj({ id: 'leaf', lifetime: { startMs: 0, endMs: 1000 } }),
    ]);

    api().splitAtPlayhead(500, []);

    // The parent itself (it has a child) is untouched — still one object, unsplit.
    expect(scene().objects.filter((o) => o.id === 'parent')).toHaveLength(1);
    expect(scene().objects.find((o) => o.id === 'parent')!.lifetime).toEqual({
      startMs: 0,
      endMs: 1000,
    });
    // The child itself has no children, so it's a valid split target and splits,
    // as does the unrelated top-level leaf object.
    expect(scene().objects).toHaveLength(5); // parent, child+clone, leaf+clone
  });

  it('is a no-op when nothing spans the playhead', () => {
    setup([obj({ id: 'a', lifetime: { startMs: 0, endMs: 1000 } })]);
    api().splitAtPlayhead(5000, ['a']);
    expect(scene().objects).toHaveLength(1);
  });
});

describe('rippleTrimObjectToPlayhead', () => {
  it('trims the in edge and clamps earlier keyframes to the new boundary', () => {
    setup([
      obj({
        id: 'a',
        lifetime: { startMs: 0, endMs: 1000 },
        tracks: { opacity: [kf(100), kf(600)] } as Tracks,
      }),
    ]);
    api().rippleTrimObjectToPlayhead('a', 400, 'in');
    const o = scene().objects[0];
    expect(o.lifetime).toEqual({ startMs: 400, endMs: 1000 });
    expect(o.tracks.opacity?.map((k) => k.timeMs)).toEqual([400, 600]);
  });

  it('trims the out edge and clamps later keyframes to the new boundary', () => {
    setup([
      obj({
        id: 'a',
        lifetime: { startMs: 0, endMs: 1000 },
        tracks: { opacity: [kf(100), kf(600)] } as Tracks,
      }),
    ]);
    api().rippleTrimObjectToPlayhead('a', 400, 'out');
    const o = scene().objects[0];
    expect(o.lifetime).toEqual({ startMs: 0, endMs: 400 });
    expect(o.tracks.opacity?.map((k) => k.timeMs)).toEqual([100, 400]);
  });

  it('is a no-op when the playhead is outside the object span', () => {
    setup([obj({ id: 'a', lifetime: { startMs: 0, endMs: 1000 } })]);
    api().rippleTrimObjectToPlayhead('a', 5000, 'in');
    expect(scene().objects[0].lifetime).toEqual({ startMs: 0, endMs: 1000 });
  });
});

describe('rippleTrimAudioClipToPlayhead', () => {
  beforeEach(() => {
    api().setProject(createDefaultProject());
  });

  it('trims the in edge, shifting offset to keep source content aligned', () => {
    api().addAudioTrack('t1');
    const trackId = scene().audioTracks[0].id;
    api().addAudioClip(trackId, clip({ id: 'c1', startMs: 0, durationMs: 1000, offsetMs: 200 }));
    api().rippleTrimAudioClipToPlayhead(trackId, 'c1', 300, 'in');
    const c = scene().audioTracks[0].clips[0];
    expect(c.startMs).toBe(300);
    expect(c.offsetMs).toBe(500); // 200 + 300
    expect(c.durationMs).toBe(700); // 1000 - 300
  });

  it('trims the out edge', () => {
    api().addAudioTrack('t1');
    const trackId = scene().audioTracks[0].id;
    api().addAudioClip(trackId, clip({ id: 'c1', startMs: 0, durationMs: 1000 }));
    api().rippleTrimAudioClipToPlayhead(trackId, 'c1', 300, 'out');
    expect(scene().audioTracks[0].clips[0].durationMs).toBe(300);
  });

  it('is a no-op outside the clip span', () => {
    api().addAudioTrack('t1');
    const trackId = scene().audioTracks[0].id;
    api().addAudioClip(trackId, clip({ id: 'c1', startMs: 0, durationMs: 1000 }));
    api().rippleTrimAudioClipToPlayhead(trackId, 'c1', 5000, 'in');
    expect(scene().audioTracks[0].clips[0].durationMs).toBe(1000);
  });
});

describe('duplicateObjectAdjacent', () => {
  it('duplicates adjacent in time with keyframes shifted by the span', () => {
    setup([
      obj({
        id: 'a',
        lifetime: { startMs: 100, endMs: 600 },
        tracks: { opacity: [kf(100), kf(400)] } as Tracks,
      }),
    ]);
    api().duplicateObjectAdjacent('a');
    expect(scene().objects).toHaveLength(2);
    const original = scene().objects.find((o) => o.id === 'a')!;
    const clone = scene().objects.find((o) => o.id !== 'a')!;
    expect(original.lifetime).toEqual({ startMs: 100, endMs: 600 }); // unchanged
    expect(clone.lifetime).toEqual({ startMs: 600, endMs: 1100 }); // span=500
    expect(clone.tracks.opacity?.map((k) => k.timeMs)).toEqual([600, 900]);
    expect(clone.id).not.toBe('a');
  });

  it('skips an object with children (leaf-only restriction)', () => {
    setup([
      obj({ id: 'parent', lifetime: { startMs: 0, endMs: 1000 } }),
      obj({ id: 'child', parentId: 'parent', lifetime: { startMs: 0, endMs: 1000 } }),
    ]);
    api().duplicateObjectAdjacent('parent');
    expect(scene().objects).toHaveLength(2);
  });
});

describe('duplicateAudioClipAdjacent', () => {
  beforeEach(() => {
    api().setProject(createDefaultProject());
  });

  it('duplicates a clip adjacent in time on the same track', () => {
    api().addAudioTrack('t1');
    const trackId = scene().audioTracks[0].id;
    api().addAudioClip(trackId, clip({ id: 'c1', startMs: 0, durationMs: 1000 }));
    api().duplicateAudioClipAdjacent(trackId, 'c1');
    const clips = scene().audioTracks[0].clips;
    expect(clips).toHaveLength(2);
    const dup = clips.find((c) => c.id !== 'c1')!;
    expect(dup.startMs).toBe(1000);
    expect(dup.durationMs).toBe(1000);
  });
});

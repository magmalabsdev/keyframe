import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveScene, getChannelTrack, useDocumentStore } from './documentStore';
import { useEditorStore } from './editorStore';
import { createDefaultProject } from './defaults';
import { evaluateCameraFov } from '../animation/evaluate';
import { DEFAULT_FOV, MAX_FOV, MIN_FOV } from './types';
import { applyCameraFovEdit } from '../animation/transformEdit';

const api = () => useDocumentStore.getState();
const camera = () => getActiveScene(api().project).camera;

describe('camera fov channel', () => {
  beforeEach(() => {
    api().setProject(createDefaultProject());
    useDocumentStore.temporal.getState().clear();
    useEditorStore.getState().setPlayhead(0);
  });

  it('new scenes start at the default fov, unkeyed', () => {
    expect(camera().fov).toBe(DEFAULT_FOV);
    expect(camera().tracks.fov).toBeUndefined();
  });

  /**
   * `camera:fov` has two colon-parts where every other camera channel has three
   * ('camera:position:0'). The parsers used to hardcode the 3-part shape, which
   * silently resolved fov to the bogus channel 'fov.undefined'.
   */
  it('resolves the two-part camera:fov key rather than "fov.undefined"', () => {
    api().cycleKeyframe('camera:fov', 500);
    expect(camera().tracks.fov).toHaveLength(1);
    expect(camera().tracks['fov.undefined' as 'fov']).toBeUndefined();
    expect(getChannelTrack(api().project, 'camera:fov')).toHaveLength(1);
  });

  it('keys the value that is live at the playhead', () => {
    api().setCameraFov(30);
    useEditorStore.getState().setPlayhead(250);
    api().cycleKeyframe('camera:fov', 250);
    expect(camera().tracks.fov?.[0].value).toBe(30);
  });

  it('prunes the track back to unkeyed when the last key is cycled off', () => {
    api().cycleKeyframe('camera:fov', 500);
    // Cycle through every easing until the channel returns to "no keyframe".
    for (let i = 0; i < 8 && camera().tracks.fov; i++) {
      api().cycleKeyframe('camera:fov', 500);
    }
    expect(camera().tracks.fov).toBeUndefined();
  });

  it('edits the static lens while unkeyed and auto-keys once animated', () => {
    applyCameraFovEdit(30);
    expect(camera().fov).toBe(30);
    expect(camera().tracks.fov).toBeUndefined();

    api().cycleKeyframe('camera:fov', 0);
    useEditorStore.getState().setPlayhead(1000);
    applyCameraFovEdit(60);
    // The static lens is untouched; the new value landed on the track instead.
    expect(camera().fov).toBe(30);
    expect(evaluateCameraFov(camera(), 1000)).toBe(60);
  });

  it('clamps out-of-range fovs', () => {
    applyCameraFovEdit(500);
    expect(camera().fov).toBe(MAX_FOV);
    applyCameraFovEdit(-10);
    expect(camera().fov).toBe(MIN_FOV);
  });

  it('bakes fov into a camera keyframe only once fov is animated', () => {
    const pose = { position: [1, 2, 3] as const, target: [0, 0, 0] as const };
    api().upsertCameraKeyframe(0, { position: [...pose.position], target: [...pose.target] });
    // Unanimated fov must not gain a track just because the pose was keyed.
    expect(camera().tracks.fov).toBeUndefined();
    expect(camera().tracks['position.0']).toHaveLength(1);

    api().cycleKeyframe('camera:fov', 0);
    api().upsertCameraKeyframe(1000, { position: [4, 5, 6], target: [0, 0, 0] });
    expect(camera().tracks.fov?.map((k) => k.timeMs)).toEqual([0, 1000]);
  });

  it('removeCameraKeyframeAtTime clears the fov key at that time too', () => {
    api().cycleKeyframe('camera:fov', 500);
    api().removeCameraKeyframeAtTime(500);
    expect(camera().tracks.fov).toBeUndefined();
  });
});

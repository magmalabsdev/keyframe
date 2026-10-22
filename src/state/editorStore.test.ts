import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

const api = () => useEditorStore.getState();

describe('playback rate / playing invariant', () => {
  beforeEach(() => {
    api().stopPlayback();
    api().setInOut(null, null);
  });

  it('starts stopped', () => {
    expect(api().playing).toBe(false);
    expect(api().playRate).toBe(0);
  });

  it('setPlayRate drives playing', () => {
    api().setPlayRate(4);
    expect(api().playing).toBe(true);
    expect(api().playRate).toBe(4);

    api().setPlayRate(0);
    expect(api().playing).toBe(false);
    expect(api().playRate).toBe(0);
  });

  it('reverse rates count as playing', () => {
    api().setPlayRate(-2);
    expect(api().playing).toBe(true);
    expect(api().playRate).toBe(-2);
  });

  it('setPlaying(true) resumes at 1x from a stop', () => {
    api().setPlaying(true);
    expect(api().playRate).toBe(1);
  });

  it('setPlaying(true) keeps the rate you were already shuttling at', () => {
    api().setPlayRate(4);
    api().setPlaying(true);
    expect(api().playRate).toBe(4);
  });

  it('setPlaying(false) zeroes the rate', () => {
    api().setPlayRate(-8);
    api().setPlaying(false);
    expect(api().playing).toBe(false);
    expect(api().playRate).toBe(0);
  });

  it('holds playing === (playRate !== 0) across a scripted sequence', () => {
    const check = () => expect(api().playing).toBe(api().playRate !== 0);
    for (const step of [
      () => api().setPlayRate(1),
      () => api().setPlayRate(2),
      () => api().setPlaying(false),
      () => api().setPlaying(true),
      () => api().setPlayRate(-4),
      () => api().stopPlayback(),
    ]) {
      step();
      check();
    }
  });

  it('clears the one-shot stop point on any rate change', () => {
    // Otherwise a leftover stop point from "play around" would truncate the
    // next ordinary play.
    api().setPlayRate(1);
    api().setStopAt(2000);
    api().setPlayRate(2);
    expect(api().stopAtMs).toBeNull();

    api().setStopAt(2000);
    api().stopPlayback();
    expect(api().stopAtMs).toBeNull();
  });

  it('exits render preview when stopping', () => {
    api().setPlaying(true);
    api().setRenderPreview(true);
    api().stopPlayback();
    expect(api().renderPreview).toBe(false);
  });
});

describe('in / out points', () => {
  beforeEach(() => api().setInOut(null, null));

  it('sets and clears each end', () => {
    api().setInPoint(1000);
    api().setOutPoint(2000);
    expect(api().inMs).toBe(1000);
    expect(api().outMs).toBe(2000);

    api().setInPoint(null);
    expect(api().inMs).toBeNull();
    expect(api().outMs).toBe(2000);
  });

  it('drops a stale out point when the in point passes it', () => {
    api().setInOut(1000, 2000);
    api().setInPoint(3000);
    expect(api().inMs).toBe(3000);
    expect(api().outMs).toBeNull();
  });

  it('drops a stale in point when the out point precedes it', () => {
    api().setInOut(1000, 2000);
    api().setOutPoint(500);
    expect(api().outMs).toBe(500);
    expect(api().inMs).toBeNull();
  });

  it('leaves a valid pair alone', () => {
    api().setInOut(1000, 2000);
    api().setOutPoint(1500);
    expect(api().inMs).toBe(1000);
    expect(api().outMs).toBe(1500);
  });
});

/**
 * The camera is selectable but is not a SceneObject, so it gets its own flag
 * rather than a reserved id inside `selectedIds` — everything consuming that
 * array assumes each entry resolves to a real object. These tests pin the
 * three-way exclusivity that makes that safe.
 */
describe('selection exclusivity', () => {
  beforeEach(() => {
    api().clearSelection();
  });

  it('starts with nothing selected', () => {
    expect(api().selectedIds).toEqual([]);
    expect(api().selectedAudioClipId).toBeNull();
    expect(api().cameraSelected).toBe(false);
  });

  it('selecting the camera clears object and audio selection', () => {
    api().setSelection(['obj-1']);
    api().setCameraSelected(true);
    expect(api().cameraSelected).toBe(true);
    expect(api().selectedIds).toEqual([]);
    expect(api().selectedAudioClipId).toBeNull();
  });

  it('selecting an object clears the camera', () => {
    api().setCameraSelected(true);
    api().setSelection(['obj-1']);
    expect(api().cameraSelected).toBe(false);
    expect(api().selectedIds).toEqual(['obj-1']);
  });

  it('toggling an object into the selection clears the camera', () => {
    api().setCameraSelected(true);
    api().toggleSelection('obj-1', true);
    expect(api().cameraSelected).toBe(false);
    expect(api().selectedIds).toEqual(['obj-1']);
  });

  it('selecting an audio clip clears the camera', () => {
    api().setCameraSelected(true);
    api().setSelectedAudioClip('clip-1');
    expect(api().cameraSelected).toBe(false);
    expect(api().selectedAudioClipId).toBe('clip-1');
  });

  it('the camera never lands in selectedIds', () => {
    api().setCameraSelected(true);
    expect(api().selectedIds).toEqual([]);
  });

  it('clearSelection deselects the camera too', () => {
    api().setCameraSelected(true);
    api().clearSelection();
    expect(api().cameraSelected).toBe(false);
  });

  it('setSelection([]) leaves the camera alone; clearSelection is the deselect-all', () => {
    api().setCameraSelected(true);
    // Only a *non-empty* setSelection means "something else was selected", so an
    // empty one is not a deselect — matching how it already treats audio clips.
    // Empty viewport clicks go through clearSelection() (useMarquee.ts:140),
    // which does drop the camera and fall back to the scene inspector.
    api().setSelection([]);
    expect(api().cameraSelected).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  applyTimelineSnap,
  clipBoundaryTimes,
  frameMsFor,
  keyframeTimes,
  navKeyframeTimes,
  nextTimeAfter,
  prevTimeBefore,
  snapToFrame,
  snapToNearest,
  snapToSecond,
  stepFrame,
  stepMs,
  TIMELINE_SNAP_PX,
} from './timeNav';
import { createDefaultScene } from '../state/defaults';
import type { Scene, Tracks } from '../state/types';

const kf = (timeMs: number) => ({
  id: `k${timeMs}`,
  timeMs,
  value: 0,
  interpolation: 'linear' as const,
});

describe('frame math', () => {
  it('derives the frame length from the rate', () => {
    expect(frameMsFor(30)).toBeCloseTo(33.333, 3);
    expect(frameMsFor(24)).toBeCloseTo(41.667, 3);
  });

  it('snaps to the nearest frame boundary', () => {
    expect(snapToFrame(0, 30)).toBe(0);
    expect(snapToFrame(30, 30)).toBeCloseTo(33.333, 3); // rounds up to frame 1
    expect(snapToFrame(20, 30)).toBeCloseTo(33.333, 3);
    expect(snapToFrame(10, 30)).toBe(0);
    expect(snapToFrame(100, 24)).toBeCloseTo(83.333, 3); // frame 2 at 24fps
  });

  it('steps from an off-grid position onto the grid', () => {
    // A scrubbed playhead is an arbitrary float; stepping should not carry the
    // drift forward.
    const t = stepFrame(1013.7, 30, 1, 5000);
    expect(t / frameMsFor(30)).toBeCloseTo(Math.round(t / frameMsFor(30)), 6);
  });

  it('steps one frame in each direction', () => {
    const f = frameMsFor(30);
    expect(stepFrame(f * 10, 30, 1, 5000)).toBeCloseTo(f * 11);
    expect(stepFrame(f * 10, 30, -1, 5000)).toBeCloseTo(f * 9);
  });

  it('clamps at both ends', () => {
    expect(stepFrame(0, 30, -1, 5000)).toBe(0);
    expect(stepFrame(5000, 30, 1, 5000)).toBe(5000);
    // setPlayhead only clamps the bottom, so the top clamp has to happen here.
    expect(stepFrame(4999, 30, 1, 5000)).toBeLessThanOrEqual(5000);
  });

  it('stepMs clamps too', () => {
    expect(stepMs(4500, 1000, 5000)).toBe(5000);
    expect(stepMs(500, -1000, 5000)).toBe(0);
    expect(stepMs(2000, 1000, 5000)).toBe(3000);
  });
});

describe('prevTimeBefore / nextTimeAfter', () => {
  const times = [0, 1000, 2000, 3000];

  it('finds the neighbouring time', () => {
    expect(prevTimeBefore(times, 2500)).toBe(2000);
    expect(nextTimeAfter(times, 2500)).toBe(3000);
  });

  it('does not stick on the current time', () => {
    // Landing exactly on a keyframe then pressing next must move on, not repeat.
    expect(nextTimeAfter(times, 2000)).toBe(3000);
    expect(prevTimeBefore(times, 2000)).toBe(1000);
  });

  it('tolerates float drift within the epsilon', () => {
    expect(nextTimeAfter(times, 2000.2)).toBe(3000);
    expect(prevTimeBefore(times, 1999.8)).toBe(1000);
  });

  it('returns null past the ends and for an empty list', () => {
    expect(prevTimeBefore(times, 0)).toBeNull();
    expect(nextTimeAfter(times, 3000)).toBeNull();
    expect(prevTimeBefore([], 100)).toBeNull();
    expect(nextTimeAfter([], 100)).toBeNull();
  });
});

describe('keyframeTimes', () => {
  it('dedupes across channels and sorts', () => {
    const tracks: Tracks = {
      'position.0': [kf(2000), kf(0)],
      'position.1': [kf(1000), kf(2000)],
      opacity: [kf(500)],
    };
    expect(keyframeTimes(tracks)).toEqual([0, 500, 1000, 2000]);
  });

  it('handles an empty track set', () => {
    expect(keyframeTimes({})).toEqual([]);
  });
});

describe('navKeyframeTimes', () => {
  function sceneWith(): Scene {
    const scene = createDefaultScene();
    scene.objects = [
      { ...scene.objects[0], id: 'a', tracks: { opacity: [kf(1000)] } },
      { ...scene.objects[0], id: 'b', tracks: { opacity: [kf(2000)] } },
    ];
    scene.camera.tracks = { 'position.0': [kf(3000)] };
    return scene;
  }

  it('uses only the selection when there is one', () => {
    expect(navKeyframeTimes(sceneWith(), ['a'])).toEqual([1000]);
    expect(navKeyframeTimes(sceneWith(), ['a', 'b'])).toEqual([1000, 2000]);
  });

  it('falls back to every object plus the camera with no selection', () => {
    expect(navKeyframeTimes(sceneWith(), [])).toEqual([1000, 2000, 3000]);
  });
});

describe('snapToSecond', () => {
  it('snaps to the nearest whole second', () => {
    expect(snapToSecond(0)).toBe(0);
    expect(snapToSecond(499)).toBe(0);
    expect(snapToSecond(501)).toBe(1000);
    expect(snapToSecond(1500)).toBe(2000);
  });
});

describe('clipBoundaryTimes', () => {
  it('aggregates lifetime edges, audio clip edges, markers, and keyframes', () => {
    const scene = createDefaultScene();
    scene.objects = [
      {
        ...scene.objects[0],
        id: 'a',
        lifetime: { startMs: 100, endMs: 900 },
        tracks: { opacity: [kf(400)] },
      },
    ];
    scene.camera.tracks = { 'position.0': [kf(700)] };
    scene.audioTracks = [
      {
        id: 't1',
        name: 'A',
        muted: false,
        gain: 1,
        clips: [
          {
            id: 'c1',
            name: 'clip',
            mediaId: 'm1',
            startMs: 200,
            offsetMs: 0,
            durationMs: 300,
            sourceDurationMs: 300,
            gain: 1,
            loop: false,
          },
        ],
      },
    ];
    scene.markers = [{ id: 'mk1', timeMs: 850, name: 'M', color: '#fff' }];

    expect(clipBoundaryTimes(scene)).toEqual([100, 200, 400, 500, 700, 850, 900]);
  });

  it('dedupes coincident boundaries', () => {
    const scene = createDefaultScene();
    scene.objects = [
      {
        ...scene.objects[0],
        id: 'a',
        lifetime: { startMs: 0, endMs: 1000 },
        tracks: { opacity: [kf(1000)] },
      },
    ];
    expect(clipBoundaryTimes(scene)).toEqual([0, 1000]);
  });

  it('excludes an object’s lifetime edges but keeps its keyframes', () => {
    const scene = createDefaultScene();
    scene.objects = [
      {
        ...scene.objects[0],
        id: 'a',
        lifetime: { startMs: 100, endMs: 900 },
        tracks: { opacity: [kf(400)] },
      },
      { ...scene.objects[0], id: 'b', lifetime: { startMs: 2000, endMs: 3000 }, tracks: {} },
    ];
    // 100/900 gone; 400 (a's keyframe) and b's edges remain.
    expect(clipBoundaryTimes(scene, { objectIds: ['a'] })).toEqual([400, 2000, 3000]);
  });

  it('excludes an audio clip’s own edges', () => {
    const scene = createDefaultScene();
    scene.objects = [];
    const clip = (id: string, startMs: number, durationMs: number) => ({
      id,
      name: id,
      mediaId: 'm1',
      startMs,
      offsetMs: 0,
      durationMs,
      sourceDurationMs: 5000,
      gain: 1,
      loop: false,
    });
    scene.audioTracks = [
      { id: 't1', name: 'A', muted: false, gain: 1, clips: [clip('c1', 0, 500), clip('c2', 2000, 500)] },
    ];
    expect(clipBoundaryTimes(scene, { audioClipIds: ['c1'] })).toEqual([2000, 2500]);
  });

  it('excludes a marker by id and exact times', () => {
    const scene = createDefaultScene();
    scene.objects = [];
    scene.markers = [
      { id: 'mk1', timeMs: 500, name: 'M1', color: '#fff' },
      { id: 'mk2', timeMs: 1500, name: 'M2', color: '#fff' },
    ];
    expect(clipBoundaryTimes(scene, { markerIds: ['mk1'] })).toEqual([1500]);
    expect(clipBoundaryTimes(scene, { times: [1500] })).toEqual([500]);
  });
});

describe('snapToNearest', () => {
  it('snaps to the closest candidate within threshold', () => {
    expect(snapToNearest(105, [0, 100, 200], 20)).toBe(100);
  });

  it('leaves ms unchanged when nothing is within threshold', () => {
    expect(snapToNearest(150, [0, 400], 20)).toBe(150);
  });

  it('does not snap exactly at the threshold boundary (strict <)', () => {
    expect(snapToNearest(120, [100], 20)).toBe(120);
    expect(snapToNearest(119, [100], 20)).toBe(100);
  });
});

describe('applyTimelineSnap', () => {
  function sceneWithMarker(atMs: number): Scene {
    const scene = createDefaultScene();
    scene.markers = [{ id: 'mk', timeMs: atMs, name: 'M', color: '#fff' }];
    return scene;
  }

  it('returns ms unchanged when no mode is active', () => {
    const scene = sceneWithMarker(1000);
    expect(
      applyTimelineSnap(1005, scene, { second: false, frame: false, clip: false }, 30, 50),
    ).toBe(1005);
  });

  it('picks whichever active-mode candidate is globally closest', () => {
    const scene = sceneWithMarker(1030);
    // second-snap candidate is 1000 (dist 20), clip candidate is 1030 (dist 10) -> clip wins
    const result = applyTimelineSnap(1020, scene, { second: true, frame: false, clip: true }, 30, 50);
    expect(result).toBe(1030);
  });

  it('falls back to the frame grid when the clip candidate is out of range', () => {
    const scene = sceneWithMarker(5000);
    const frame = frameMsFor(30);
    const nearFrame = Math.round(1000 / frame) * frame;
    const result = applyTimelineSnap(nearFrame + 2, scene, { second: false, frame: true, clip: true }, 30, 10);
    expect(result).toBeCloseTo(nearFrame, 3);
  });

  it('respects the threshold boundary for the clip candidate', () => {
    const scene = sceneWithMarker(1000);
    expect(
      applyTimelineSnap(1020, scene, { second: false, frame: false, clip: true }, 30, 20),
    ).toBe(1020);
    expect(
      applyTimelineSnap(1019, scene, { second: false, frame: false, clip: true }, 30, 20),
    ).toBe(1000);
  });

  it('does not snap to an excluded (dragged) item’s own boundary', () => {
    // The regression test for self-snap feedback: with the only clip candidate
    // being the dragged object's own edge, snapping must be inert rather than
    // pinning the drag to where it started.
    const scene = createDefaultScene();
    scene.objects = [
      { ...scene.objects[0], id: 'a', lifetime: { startMs: 1000, endMs: 2000 }, tracks: {} },
    ];
    const modes = { second: false, frame: false, clip: true };
    expect(applyTimelineSnap(1005, scene, modes, 30, 50)).toBe(1000); // without exclusion
    expect(applyTimelineSnap(1005, scene, modes, 30, 50, { objectIds: ['a'] })).toBe(1005);
  });

  it('still snaps to the 1s grid when the clip candidate is excluded', () => {
    // Guards the load-bearing `nearestClip !== ms` line: excluding the clip
    // candidate must not suppress the second-grid candidate.
    const scene = createDefaultScene();
    scene.objects = [
      { ...scene.objects[0], id: 'a', lifetime: { startMs: 1005, endMs: 2000 }, tracks: {} },
    ];
    const out = applyTimelineSnap(
      1005,
      scene,
      { second: true, frame: false, clip: true },
      30,
      50,
      { objectIds: ['a'] },
    );
    expect(out).toBe(1000);
  });
});

describe('TIMELINE_SNAP_PX', () => {
  it('is 12px of constant screen-space stickiness', () => {
    expect(TIMELINE_SNAP_PX).toBe(12);
  });

  it('yields a sub-frame threshold at max zoom (a genuine 12px magnet)', () => {
    const MAX_PX_PER_MS = 5;
    expect(TIMELINE_SNAP_PX / MAX_PX_PER_MS).toBeCloseTo(2.4, 6);
    expect(TIMELINE_SNAP_PX / MAX_PX_PER_MS).toBeLessThan(frameMsFor(30) / 2);
  });
});

import { describe, it, expect } from 'vitest';
import {
  ease,
  evaluateTrack,
  evaluateColorTrack,
  evaluateObject,
  evaluateCamera,
  isObjectActive,
} from './evaluate';
import type { CameraKeyframe, Easing, SceneObject, ValueKeyframe } from '../state/types';

function vk(timeMs: number, value: number | string, interpolation: Easing = 'linear'): ValueKeyframe {
  return { id: `k${timeMs}`, timeMs, value, interpolation };
}

describe('ease', () => {
  it('linear is identity at endpoints and midpoint', () => {
    expect(ease(0, 'linear')).toBe(0);
    expect(ease(1, 'linear')).toBe(1);
    expect(ease(0.5, 'linear')).toBe(0.5);
  });
  it('step holds the from-value', () => {
    expect(ease(0.99, 'step')).toBe(0);
  });
  it('easeInOut is symmetric around 0.5', () => {
    expect(ease(0.5, 'easeInOut')).toBeCloseTo(0.5, 5);
    expect(ease(0.25, 'easeInOut') + ease(0.75, 'easeInOut')).toBeCloseTo(1, 5);
  });
});

describe('evaluateTrack', () => {
  it('returns the fallback for an empty/undefined track', () => {
    expect(evaluateTrack(undefined, 100, 7)).toBe(7);
    expect(evaluateTrack([], 100, 7)).toBe(7);
  });

  it('clamps before the first and after the last keyframe', () => {
    const t = [vk(1000, 10), vk(2000, 20)];
    expect(evaluateTrack(t, 0, 0)).toBe(10);
    expect(evaluateTrack(t, 5000, 0)).toBe(20);
  });

  it('linearly interpolates and selects the right segment', () => {
    const t = [vk(0, 0), vk(1000, 10), vk(2000, 30)];
    expect(evaluateTrack(t, 500, 0)).toBeCloseTo(5, 5);
    expect(evaluateTrack(t, 1500, 0)).toBeCloseTo(20, 5);
  });

  it('honors the from-keyframe easing (step holds)', () => {
    const t = [vk(0, 0, 'step'), vk(1000, 100)];
    expect(evaluateTrack(t, 500, 0)).toBe(0);
    expect(evaluateTrack(t, 1000, 0)).toBe(100);
  });
});

describe('evaluateColorTrack', () => {
  it('interpolates hex colors', () => {
    const t = [vk(1000, '#000000'), vk(2000, '#ffffff')];
    expect(evaluateColorTrack(t, 1500, '#888888')).toBe('#808080');
    expect(evaluateColorTrack(undefined, 1500, '#ff0000')).toBe('#ff0000');
  });
});

describe('evaluateObject (per-channel tracks)', () => {
  const base: SceneObject = {
    id: 'o',
    name: 'o',
    type: 'mesh',
    parentId: null,
    assetId: 'a',
    visible: true,
    lifetime: { startMs: 0, endMs: 4000 },
    transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#abcdef', opacity: 0.5, metalness: 0, roughness: 1 },
  };

  it('falls back to the base transform/material when a channel is unkeyed', () => {
    const p = evaluateObject(base, 1000);
    expect(p.position).toEqual([1, 2, 3]);
    expect(p.color).toBe('#abcdef');
    expect(p.opacity).toBe(0.5);
  });

  it('animates channels independently', () => {
    const obj: SceneObject = {
      ...base,
      tracks: { 'position.0': [vk(0, 0), vk(1000, 100)] },
    };
    // x animates; y/z stay at base.
    expect(evaluateObject(obj, 500).position[0]).toBeCloseTo(50, 5);
    expect(evaluateObject(obj, 500).position[1]).toBe(2);
    expect(evaluateObject(obj, 500).position[2]).toBe(3);
  });
});

describe('evaluateCamera', () => {
  const ckf = (timeMs: number, px: number): CameraKeyframe => ({
    id: `c${timeMs}`,
    timeMs,
    position: [px, 0, 0],
    target: [0, 0, 0],
    interpolation: 'linear',
  });
  it('returns default when no keyframes', () => {
    const def = { position: [0, 0, 1200] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    expect(evaluateCamera(def, [], 500)).toEqual(def);
  });
  it('interpolates camera position', () => {
    const def = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const keys = [ckf(0, 0), ckf(1000, 100)];
    expect(evaluateCamera(def, keys, 500).position[0]).toBeCloseTo(50, 5);
  });
});

describe('isObjectActive', () => {
  const obj = {
    lifetime: { startMs: 1000, endMs: 3000 },
  } as SceneObject;
  it('is active within its lifetime, inactive outside', () => {
    expect(isObjectActive(obj, 500)).toBe(false);
    expect(isObjectActive(obj, 2000)).toBe(true);
    expect(isObjectActive(obj, 3500)).toBe(false);
  });
});

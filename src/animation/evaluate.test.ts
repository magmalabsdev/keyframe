import { describe, it, expect } from 'vitest';
import { ease, evaluateKeyframes, evaluateCamera, isObjectActive } from './evaluate';
import type { CameraKeyframe, Keyframe, SceneObject } from '../state/types';

function kf(timeMs: number, x: number, partial: Partial<Keyframe> = {}): Keyframe {
  return {
    id: `k${timeMs}`,
    timeMs,
    position: [x, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    interpolation: 'linear',
    ...partial,
  };
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

describe('evaluateKeyframes', () => {
  it('clamps before the first and after the last keyframe', () => {
    const keys = [kf(1000, 10), kf(2000, 20)];
    expect(evaluateKeyframes(keys, 0).position[0]).toBe(10);
    expect(evaluateKeyframes(keys, 5000).position[0]).toBe(20);
  });

  it('linearly interpolates between two keyframes', () => {
    const keys = [kf(1000, 0), kf(2000, 100)];
    expect(evaluateKeyframes(keys, 1500).position[0]).toBeCloseTo(50, 5);
    expect(evaluateKeyframes(keys, 1250).position[0]).toBeCloseTo(25, 5);
  });

  it('selects the correct segment across many keyframes', () => {
    const keys = [kf(0, 0), kf(1000, 10), kf(2000, 30), kf(3000, 30)];
    expect(evaluateKeyframes(keys, 1500).position[0]).toBeCloseTo(20, 5);
    expect(evaluateKeyframes(keys, 2500).position[0]).toBeCloseTo(30, 5);
  });

  it('honors the from-keyframe easing (step holds)', () => {
    const keys = [kf(0, 0, { interpolation: 'step' }), kf(1000, 100)];
    expect(evaluateKeyframes(keys, 500).position[0]).toBe(0);
    expect(evaluateKeyframes(keys, 999).position[0]).toBe(0);
    expect(evaluateKeyframes(keys, 1000).position[0]).toBe(100);
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

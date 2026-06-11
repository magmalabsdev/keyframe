import { describe, it, expect } from 'vitest';
import { poseObjectAtTime } from './pose';
import type { SceneObject } from '../state/types';

function obj(partial: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'o',
    name: 'o',
    type: 'mesh',
    parentId: null,
    assetId: 'a',
    visible: true,
    lifetime: { startMs: 0, endMs: 4000 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    keyframes: [],
    centerOfRotation: [0, 0, 0],
    material: { color: '#fff', opacity: 1, metalness: 0, roughness: 1 },
    ...partial,
  };
}

describe('poseObjectAtTime', () => {
  it('returns base transform with full opacity when no animations', () => {
    const p = poseObjectAtTime(obj(), 1000);
    expect(p.opacityMul).toBe(1);
    expect(p.rotation).toEqual([0, 0, 0]);
    expect(p.visible).toBe(true);
  });

  it('is invisible outside its lifetime', () => {
    expect(poseObjectAtTime(obj(), 5000).visible).toBe(false);
  });

  it('idle rotate adds rotation over time', () => {
    const o = obj({ idle: { type: 'rotate', speed: 1, axis: 'z' } });
    expect(poseObjectAtTime(o, 0).rotation[2]).toBeCloseTo(0, 5);
    // 1s at 90 deg/s → ~90 degrees about Z
    expect(poseObjectAtTime(o, 1000).rotation[2]).toBeCloseTo(90, 3);
  });

  it('fade start ramps opacity from 0 to 1 over the duration', () => {
    const o = obj({ startAnim: { type: 'fade', durationMs: 1000 } });
    expect(poseObjectAtTime(o, 0).opacityMul).toBeCloseTo(0, 3);
    expect(poseObjectAtTime(o, 500).opacityMul).toBeCloseTo(0.5, 3);
    expect(poseObjectAtTime(o, 1500).opacityMul).toBeCloseTo(1, 3);
  });

  it('pop start scales up from ~0', () => {
    const o = obj({ startAnim: { type: 'pop', durationMs: 1000 } });
    expect(poseObjectAtTime(o, 0).scale[0]).toBeLessThan(0.2);
    expect(poseObjectAtTime(o, 2000).scale[0]).toBeCloseTo(1, 3);
  });

  it('fade end ramps opacity back down near the end', () => {
    const o = obj({ endAnim: { type: 'fade', durationMs: 1000 } });
    expect(poseObjectAtTime(o, 3500).opacityMul).toBeCloseTo(0.5, 3);
    expect(poseObjectAtTime(o, 4000).opacityMul).toBeCloseTo(0, 3);
  });
});

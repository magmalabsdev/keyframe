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
    tracks: {},
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

  it('reports the base material opacity', () => {
    expect(poseObjectAtTime(obj(), 1000).opacity).toBe(1);
    expect(
      poseObjectAtTime(obj({ material: { color: '#fff', opacity: 0.4, metalness: 0, roughness: 1 } }), 1000)
        .opacity,
    ).toBe(0.4);
  });

  it('applies a time-dependent binding override to a transform channel', () => {
    const o = obj({ id: 'box' });
    const ctx = {
      bindings: { 'object:box:position:0': 'time*100' },
      vars: { time: 2 },
    };
    expect(poseObjectAtTime(o, 2000, ctx).position[0]).toBe(200);
    // Other axes untouched.
    expect(poseObjectAtTime(o, 2000, ctx).position[1]).toBe(0);
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

  it('form start transition sets fragment progress and leaves transform untouched', () => {
    const o = obj({ startAnim: { type: 'voxel form', durationMs: 1000 } });
    const mid = poseObjectAtTime(o, 250);
    expect(mid.fragment).toEqual({ which: 'start', progress: 0.25 });
    // Chunks own the visuals: scale/opacity stay neutral.
    expect(mid.scale).toEqual([1, 1, 1]);
    expect(mid.opacityMul).toBe(1);
    // After the window the part is solid again (no fragment).
    expect(poseObjectAtTime(o, 1500).fragment).toBeNull();
  });

  it('form end transition disperses (progress 1 -> 0) near the end', () => {
    const o = obj({ endAnim: { type: 'particle form', durationMs: 1000 } });
    expect(poseObjectAtTime(o, 3000).fragment).toBeNull();
    expect(poseObjectAtTime(o, 3500).fragment).toEqual({ which: 'end', progress: 0.5 });
    expect(poseObjectAtTime(o, 4000).fragment).toEqual({ which: 'end', progress: 0 });
  });

  it('non-form transitions leave fragment null', () => {
    const o = obj({ startAnim: { type: 'fade', durationMs: 1000 } });
    expect(poseObjectAtTime(o, 500).fragment).toBeNull();
  });
});

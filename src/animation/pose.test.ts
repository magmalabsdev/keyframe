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

  it('passes light values through unchanged; consumers dim via opacityMul', () => {
    const o = obj({
      light: {
        enabled: true,
        color: '#ffaa00',
        intensity: 4,
        spreadDeg: 90,
        softness: 0.5,
        direction: [0, 0, -1],
      },
      startAnim: { type: 'fade', durationMs: 1000 },
    });
    const mid = poseObjectAtTime(o, 500);
    // The dimming contract: pose.light.intensity stays at the evaluated value
    // and applyObjectPose multiplies by opacityMul (0.5 mid-fade).
    expect(mid.light!.intensity).toBe(4);
    expect(mid.light!.color).toBe('#ffaa00');
    expect(mid.opacityMul).toBeCloseTo(0.5, 3);
  });

  it('has no light values for objects without light params', () => {
    expect(poseObjectAtTime(obj(), 1000).light).toBeUndefined();
  });
});

describe('glyph write-on masking', () => {
  function textParent(writeOn: number | undefined, tracks: SceneObject['tracks'] = {}): SceneObject {
    return obj({
      id: 'parent',
      type: 'text',
      assetId: null,
      tracks,
      text: {
        text: 'AB C', // 4 characters incl. the space
        fontSize: 40,
        depth: 10,
        align: 'center',
        letterSpacing: 0,
        lineHeight: 1.15,
        writeOn,
      },
    });
  }
  function glyph(index: number): SceneObject {
    return obj({
      id: `g${index}`,
      type: 'glyph',
      assetId: null,
      parentId: 'parent',
      glyph: { char: 'A', index, layoutPos: [0, 0, 0] },
    });
  }
  const ctxFor = (parent: SceneObject) => ({
    bindings: {},
    vars: {},
    objectById: new Map([[parent.id, parent]]),
  });

  it('hides glyphs beyond the revealed count', () => {
    const parent = textParent(0.5); // 4 chars -> 2 revealed
    const ctx = ctxFor(parent);
    expect(poseObjectAtTime(glyph(0), 1000, ctx).visible).toBe(true);
    expect(poseObjectAtTime(glyph(1), 1000, ctx).visible).toBe(true);
    expect(poseObjectAtTime(glyph(3), 1000, ctx).visible).toBe(false);
  });

  it('shows every glyph at full reveal and none at zero', () => {
    const full = ctxFor(textParent(1));
    expect(poseObjectAtTime(glyph(3), 1000, full).visible).toBe(true);
    const none = ctxFor(textParent(0));
    expect(poseObjectAtTime(glyph(0), 1000, none).visible).toBe(false);
  });

  it('follows the parent write-on track over time', () => {
    const parent = textParent(1, {
      'text.writeOn': [
        { id: 'w0', timeMs: 0, value: 0, interpolation: 'linear' },
        { id: 'w1', timeMs: 1000, value: 1, interpolation: 'linear' },
      ],
    });
    const ctx = ctxFor(parent);
    expect(poseObjectAtTime(glyph(3), 100, ctx).visible).toBe(false);
    expect(poseObjectAtTime(glyph(3), 1000, ctx).visible).toBe(true);
  });

  it('does not mask glyphs without context (three hierarchy still hides via parent)', () => {
    expect(poseObjectAtTime(glyph(3), 1000).visible).toBe(true);
  });

  it('inherits the parent transition opacity (fade dims each character)', () => {
    const parent = textParent(1);
    parent.startAnim = { type: 'fade', durationMs: 1000 };
    const ctx = ctxFor(parent);
    expect(poseObjectAtTime(glyph(0), 500, ctx).opacityMul).toBeCloseTo(0.5, 5);
  });

  it('passes writeOn through the pose for text parents', () => {
    expect(poseObjectAtTime(textParent(0.5), 1000).writeOn).toBe(0.5);
  });
});

describe('glyph form transition cascade', () => {
  const voxel = { type: 'voxel form' as const, durationMs: 1000 };
  const particle = { type: 'particle form' as const, durationMs: 1000 };

  function parentText(partial: Partial<SceneObject> = {}): SceneObject {
    return obj({
      id: 'parent',
      type: 'text',
      assetId: null,
      text: {
        text: 'AB',
        fontSize: 40,
        depth: 10,
        align: 'center',
        letterSpacing: 0,
        lineHeight: 1.15,
        writeOn: 1,
      },
      ...partial,
    });
  }
  function glyphOf(parent: SceneObject, partial: Partial<SceneObject> = {}): SceneObject {
    return obj({
      id: 'g',
      type: 'glyph',
      assetId: null,
      parentId: parent.id,
      glyph: { char: 'A', index: 0, layoutPos: [0, 0, 0] },
      ...partial,
    });
  }
  const ctxFor = (parent: SceneObject) => ({
    bindings: {},
    vars: {},
    objectById: new Map([[parent.id, parent]]),
  });

  it('inherits the parent text’s form transition', () => {
    const parent = parentText({ startAnim: voxel });
    const p = poseObjectAtTime(glyphOf(parent), 500, ctxFor(parent));
    expect(p.fragment).toEqual({ which: 'start', progress: 0.5 });
  });

  it('keeps the glyph’s own form transition instead of the parent’s', () => {
    const parent = parentText({ startAnim: voxel, endAnim: voxel });
    const g = glyphOf(parent, { startAnim: particle });
    // Its own transition drives it; the parent's is not layered on.
    expect(poseObjectAtTime(g, 500, ctxFor(parent)).fragment).toEqual({
      which: 'start',
      progress: 0.5,
    });
  });

  it('lets a non-form transition on the glyph block inheritance', () => {
    const parent = parentText({ startAnim: voxel });
    const g = glyphOf(parent, { startAnim: { type: 'fade', durationMs: 1000 } });
    expect(poseObjectAtTime(g, 500, ctxFor(parent)).fragment).toBeNull();
  });

  it('does not inherit without an object map (export/live parity guard)', () => {
    const parent = parentText({ startAnim: voxel });
    expect(poseObjectAtTime(glyphOf(parent), 500).fragment).toBeNull();
  });

  it('still inherits while hidden by the write-on reveal', () => {
    // Otherwise a glyph would pop in un-fragmented the instant it's revealed.
    const parent = parentText({ startAnim: voxel, text: {
      text: 'AB', fontSize: 40, depth: 10, align: 'center',
      letterSpacing: 0, lineHeight: 1.15, writeOn: 0,
    } });
    const p = poseObjectAtTime(glyphOf(parent), 500, ctxFor(parent));
    expect(p.visible).toBe(false);
    expect(p.fragment).toEqual({ which: 'start', progress: 0.5 });
  });

  it('cascades the end transition too', () => {
    const parent = parentText({ endAnim: voxel });
    const p = poseObjectAtTime(glyphOf(parent), 3500, ctxFor(parent));
    expect(p.fragment).toEqual({ which: 'end', progress: 0.5 });
  });
});

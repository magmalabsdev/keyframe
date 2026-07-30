import { describe, it, expect } from 'vitest';
import { effectiveFormTransition } from './formTransition';
import type { SceneObject, Transition } from '../state/types';

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

const voxel: Transition = { type: 'voxel form', durationMs: 500 };
const particle: Transition = { type: 'particle form', durationMs: 500 };
const fade: Transition = { type: 'fade', durationMs: 500 };

const glyph = (partial: Partial<SceneObject> = {}) =>
  obj({ id: 'g', type: 'glyph', assetId: null, parentId: 'p', ...partial });
const textParent = (partial: Partial<SceneObject> = {}) =>
  obj({ id: 'p', type: 'text', assetId: null, ...partial });

describe('effectiveFormTransition', () => {
  it('returns an object’s own form transition', () => {
    expect(effectiveFormTransition(obj({ startAnim: voxel }), 'start')).toBe(voxel);
  });

  it('returns null for a non-form transition', () => {
    expect(effectiveFormTransition(obj({ startAnim: fade }), 'start')).toBeNull();
  });

  it('resolves each edge independently', () => {
    const o = obj({ startAnim: voxel, endAnim: fade });
    expect(effectiveFormTransition(o, 'start')).toBe(voxel);
    expect(effectiveFormTransition(o, 'end')).toBeNull();
  });

  it('inherits the parent text’s form when the glyph has none', () => {
    const parent = textParent({ startAnim: voxel });
    expect(effectiveFormTransition(glyph(), 'start', parent)).toBe(voxel);
  });

  it('inherits when the glyph’s own transition is explicitly none', () => {
    const parent = textParent({ startAnim: voxel });
    const g = glyph({ startAnim: { type: 'none', durationMs: 500 } });
    expect(effectiveFormTransition(g, 'start', parent)).toBe(voxel);
  });

  it('lets the glyph’s own form transition win', () => {
    const parent = textParent({ startAnim: voxel });
    const g = glyph({ startAnim: particle });
    expect(effectiveFormTransition(g, 'start', parent)).toBe(particle);
  });

  it('lets a non-form transition on the glyph block inheritance', () => {
    const parent = textParent({ startAnim: voxel });
    expect(effectiveFormTransition(glyph({ startAnim: fade }), 'start', parent)).toBeNull();
  });

  it('does not inherit a non-form parent transition', () => {
    const parent = textParent({ startAnim: fade });
    expect(effectiveFormTransition(glyph(), 'start', parent)).toBeNull();
  });

  it('does not inherit without a parent, or from a non-text parent', () => {
    expect(effectiveFormTransition(glyph(), 'start')).toBeNull();
    const group = obj({ id: 'p', type: 'group', assetId: null, startAnim: voxel });
    expect(effectiveFormTransition(glyph(), 'start', group)).toBeNull();
  });
});

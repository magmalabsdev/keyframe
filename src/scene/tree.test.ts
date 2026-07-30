import { describe, it, expect } from 'vitest';
import { childrenOf, descendantIds, flattenTree, topLevelAncestor } from './tree';
import type { SceneObject } from '../state/types';

function obj(id: string, parentId: string | null): SceneObject {
  return {
    id,
    name: id,
    type: 'mesh',
    parentId,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: 1000 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#fff', opacity: 1, metalness: 0, roughness: 1 },
  };
}

// g(root) -> a, b ; b -> c
const objects = [
  obj('g', null),
  obj('a', 'g'),
  obj('b', 'g'),
  obj('c', 'b'),
  obj('top', null),
];

describe('tree helpers', () => {
  it('childrenOf returns direct children / roots', () => {
    expect(childrenOf(objects, null).map((o) => o.id)).toEqual(['g', 'top']);
    expect(childrenOf(objects, 'g').map((o) => o.id)).toEqual(['a', 'b']);
    expect(childrenOf(objects, 'b').map((o) => o.id)).toEqual(['c']);
  });

  it('topLevelAncestor walks to the root', () => {
    expect(topLevelAncestor(objects, 'c')).toBe('g');
    expect(topLevelAncestor(objects, 'a')).toBe('g');
    expect(topLevelAncestor(objects, 'g')).toBe('g');
    expect(topLevelAncestor(objects, 'top')).toBe('top');
  });

  it('descendantIds collects the whole subtree', () => {
    expect(descendantIds(objects, 'g').sort()).toEqual(['a', 'b', 'c']);
    expect(descendantIds(objects, 'b')).toEqual(['c']);
    expect(descendantIds(objects, 'top')).toEqual([]);
  });

  it('flattenTree walks depth-first through non-group parents', () => {
    // Every kind can hold children now: a surface parents to the mesh it sits
    // on, and these are all meshes.
    expect(flattenTree(objects).map((o) => o.id)).toEqual(['g', 'a', 'b', 'c', 'top']);
  });

  it('flattenTree recurses into a surface parented to a mesh', () => {
    const withSurface = [
      obj('host', null),
      { ...obj('label', 'host'), type: 'surface' as const },
    ];
    expect(flattenTree(withSurface).map((o) => o.id)).toEqual(['host', 'label']);
  });
});

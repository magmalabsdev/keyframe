import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getFaceTriangles } from './faceGroups';

describe('getFaceTriangles', () => {
  it('groups the two triangles forming a box face', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    const group = getFaceTriangles(box, 0);
    expect(group.length).toBe(2);
    expect(group).toContain(0);
  });

  it('keeps separate faces in separate groups', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    const triCount = (box.getIndex()?.count ?? 0) / 3;
    const groups = new Set<string>();
    for (let t = 0; t < triCount; t++) {
      groups.add(getFaceTriangles(box, t).slice().sort().join(','));
    }
    // A box has 6 faces, each made of 2 triangles.
    expect(groups.size).toBe(6);
  });

  it('caches results per geometry', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    const a = getFaceTriangles(box, 0);
    const b = getFaceTriangles(box, 0);
    expect(a).toBe(b);
  });
});

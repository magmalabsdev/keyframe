import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ensureNormals, hasUsableNormals } from './normals';

/** A non-indexed triangle, the shape STLLoader produces. */
function triangle(normals?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  if (normals) {
    g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(normals), 3));
  }
  return g;
}

describe('hasUsableNormals', () => {
  it('accepts real unit normals', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    expect(hasUsableNormals(box.getAttribute('normal').array as Float32Array)).toBe(true);
  });

  it('rejects all-zero normals (the STL facet-normal-0-0-0 case)', () => {
    expect(hasUsableNormals(new Float32Array(9))).toBe(false);
  });

  it('rejects a single zero triple among good ones', () => {
    // The case a sampling check would miss: one bad facet renders as an
    // invisible black patch on an otherwise correct mesh.
    expect(hasUsableNormals(Float32Array.from([0, 0, 1, 0, 0, 0, 0, 0, 1]))).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(hasUsableNormals(Float32Array.from([0, 0, 1, NaN, 0, 0, 0, 0, 1]))).toBe(false);
    expect(hasUsableNormals(Float32Array.from([Infinity, 0, 0]))).toBe(false);
  });

  it('accepts an empty array (nothing to shade)', () => {
    expect(hasUsableNormals(new Float32Array(0))).toBe(true);
  });
});

describe('ensureNormals', () => {
  it('repairs zeroed normals to unit length', () => {
    const g = triangle([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ensureNormals(g)).toBe(true);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('computes normals when the attribute is missing', () => {
    const g = triangle();
    expect(ensureNormals(g)).toBe(true);
    expect(g.getAttribute('normal')).toBeDefined();
  });

  it('repairs when the normal count does not match position', () => {
    const g = triangle([0, 0, 1]); // one normal for three vertices
    expect(ensureNormals(g)).toBe(true);
    expect(g.getAttribute('normal').count).toBe(3);
  });

  it('leaves valid normals untouched, keeping the same attribute instance', () => {
    const g = triangle([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const before = g.getAttribute('normal');
    expect(ensureNormals(g)).toBe(false);
    expect(g.getAttribute('normal')).toBe(before);
  });
});

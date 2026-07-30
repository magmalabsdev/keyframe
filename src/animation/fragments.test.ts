import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getFragmentGeometry } from './fragments';

let counter = 0;
/** A distinct source each call, so cache keys don't collide between tests. */
function box(): { key: string; geometry: THREE.BufferGeometry } {
  const geometry = new THREE.BoxGeometry(100, 60, 40);
  geometry.computeBoundingBox();
  return { key: `box-${counter++}`, geometry };
}

const ATTRS = ['aCentroid', 'aOffset', 'aAxis', 'aAngle'] as const;

describe('getFragmentGeometry', () => {
  it('voxel form produces non-empty geometry with the fragment attributes', () => {
    const { key, geometry } = box();
    const geo = getFragmentGeometry(key, geometry, 'voxel form', 0.5, false);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    for (const a of ATTRS) expect(geo.getAttribute(a)).toBeDefined();
    // aAngle is a scalar (itemSize 1), the rest are vec3.
    expect(geo.getAttribute('aAngle').itemSize).toBe(1);
    expect(geo.getAttribute('aCentroid').itemSize).toBe(3);
  });

  it('higher density yields more voxel chunks', () => {
    const a = box();
    const b = box();
    const low = getFragmentGeometry(a.key, a.geometry, 'voxel form', 0.1, false);
    const high = getFragmentGeometry(b.key, b.geometry, 'voxel form', 0.95, false);
    expect(high.getAttribute('position').count).toBeGreaterThan(
      low.getAttribute('position').count,
    );
  });

  it('solid fill adds interior voxels beyond the shell', () => {
    const { key, geometry } = box();
    const shell = getFragmentGeometry(key, geometry, 'voxel form', 0.5, false);
    const solid = getFragmentGeometry(key, geometry, 'voxel form', 0.5, true);
    expect(solid.getAttribute('position').count).toBeGreaterThan(
      shell.getAttribute('position').count,
    );
  });

  it('particle form chunk count grows with density', () => {
    const a = box();
    const b = box();
    const low = getFragmentGeometry(a.key, a.geometry, 'particle form', 0.1, false);
    const high = getFragmentGeometry(b.key, b.geometry, 'particle form', 0.9, false);
    expect(high.getAttribute('position').count).toBeGreaterThan(
      low.getAttribute('position').count,
    );
  });

  it('polygon form keeps all source triangles (sum of cluster shards)', () => {
    const { key, geometry } = box();
    const srcVerts = new THREE.BoxGeometry(100, 60, 40).toNonIndexed()
      .getAttribute('position').count;
    const geo = getFragmentGeometry(key, geometry, 'polygon form', 0.5, false);
    expect(geo.getAttribute('position').count).toBe(srcVerts);
  });

  it('caches by source+form+density+fill (same instance on repeat call)', () => {
    const { key, geometry } = box();
    const a = getFragmentGeometry(key, geometry, 'voxel form', 0.5, false);
    const b = getFragmentGeometry(key, geometry, 'voxel form', 0.5, false);
    expect(a).toBe(b);
  });

  it('keys on the source key, so identical geometry under two keys differs', () => {
    // Glyphs and surfaces share geometry shapes across objects; the key is what
    // separates (and deterministically seeds) them.
    const shared = new THREE.BoxGeometry(100, 60, 40);
    shared.computeBoundingBox();
    const a = getFragmentGeometry('key-a', shared, 'voxel form', 0.5, false);
    const b = getFragmentGeometry('key-b', shared, 'voxel form', 0.5, false);
    expect(a).not.toBe(b);
  });

  it('evicts the oldest entry once the cache is full', () => {
    // Derived keys (glyph size/depth edits, surface point edits) churn, so the
    // cache must not grow without bound the way stable asset ids allowed.
    const { key, geometry } = box();
    const first = getFragmentGeometry(key, geometry, 'voxel form', 0.5, false);
    expect(getFragmentGeometry(key, geometry, 'voxel form', 0.5, false)).toBe(first);
    for (let i = 0; i < 130; i++) {
      const filler = box();
      getFragmentGeometry(filler.key, filler.geometry, 'voxel form', 0.2, false);
    }
    expect(getFragmentGeometry(key, geometry, 'voxel form', 0.5, false)).not.toBe(first);
  });
});

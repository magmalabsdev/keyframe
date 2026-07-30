import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Asset } from '../state/types';
import { geometryToData, putGeometryData } from '../io/geometryCache';
import { getFragmentGeometry } from './fragments';

let counter = 0;
function boxAsset(): Asset {
  const g = new THREE.BoxGeometry(100, 60, 40);
  const id = `box-${counter++}`;
  // Geometry lives in the cache, keyed by id (not on the asset).
  putGeometryData(id, geometryToData(g));
  return { id, name: 'box', format: 'stl' };
}

const ATTRS = ['aCentroid', 'aOffset', 'aAxis', 'aAngle'] as const;

describe('getFragmentGeometry', () => {
  it('voxel form produces non-empty geometry with the fragment attributes', () => {
    const geo = getFragmentGeometry(boxAsset(), 'voxel form', 0.5, false);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    for (const a of ATTRS) expect(geo.getAttribute(a)).toBeDefined();
    // aAngle is a scalar (itemSize 1), the rest are vec3.
    expect(geo.getAttribute('aAngle').itemSize).toBe(1);
    expect(geo.getAttribute('aCentroid').itemSize).toBe(3);
  });

  it('higher density yields more voxel chunks', () => {
    const low = getFragmentGeometry(boxAsset(), 'voxel form', 0.1, false);
    const high = getFragmentGeometry(boxAsset(), 'voxel form', 0.95, false);
    expect(high.getAttribute('position').count).toBeGreaterThan(
      low.getAttribute('position').count,
    );
  });

  it('solid fill adds interior voxels beyond the shell', () => {
    const asset = boxAsset();
    const shell = getFragmentGeometry(asset, 'voxel form', 0.5, false);
    const solid = getFragmentGeometry(asset, 'voxel form', 0.5, true);
    expect(solid.getAttribute('position').count).toBeGreaterThan(
      shell.getAttribute('position').count,
    );
  });

  it('particle form chunk count grows with density', () => {
    const low = getFragmentGeometry(boxAsset(), 'particle form', 0.1, false);
    const high = getFragmentGeometry(boxAsset(), 'particle form', 0.9, false);
    expect(high.getAttribute('position').count).toBeGreaterThan(
      low.getAttribute('position').count,
    );
  });

  it('polygon form keeps all source triangles (sum of cluster shards)', () => {
    const asset = boxAsset();
    const src = new THREE.BoxGeometry(100, 60, 40).toNonIndexed();
    const srcVerts = src.getAttribute('position').count;
    const geo = getFragmentGeometry(asset, 'polygon form', 0.5, false);
    expect(geo.getAttribute('position').count).toBe(srcVerts);
  });

  it('caches by asset+form+density+fill (same instance on repeat call)', () => {
    const asset = boxAsset();
    const a = getFragmentGeometry(asset, 'voxel form', 0.5, false);
    const b = getFragmentGeometry(asset, 'voxel form', 0.5, false);
    expect(a).toBe(b);
  });
});

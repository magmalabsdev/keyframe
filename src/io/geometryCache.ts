import * as THREE from 'three';
import type { Asset, GeometryData } from '../state/types';

/**
 * Runtime cache mapping assetId -> THREE.BufferGeometry. Geometry is heavy and
 * non-serializable, so it lives here rather than in the document store. The
 * store only holds the serializable GeometryData (flat arrays).
 */
const cache = new Map<string, THREE.BufferGeometry>();

export function buildGeometry(data: GeometryData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.normals && data.normals.length > 0) {
    g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  }
  if (data.index && data.index.length > 0) {
    g.setIndex(data.index);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Returns the cached geometry for an asset, building it on first access. */
export function getGeometry(asset: Asset): THREE.BufferGeometry {
  let g = cache.get(asset.id);
  if (!g) {
    g = buildGeometry(asset.geometry);
    cache.set(asset.id, g);
  }
  return g;
}

/** Registers a freshly-imported geometry so it doesn't need rebuilding. */
export function putGeometry(id: string, geometry: THREE.BufferGeometry): void {
  cache.set(id, geometry);
}

export function hasGeometry(id: string): boolean {
  return cache.has(id);
}

/** Extracts serializable GeometryData from a BufferGeometry. */
export function geometryToData(g: THREE.BufferGeometry): GeometryData {
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const index = g.getIndex();
  return {
    positions: Array.from(position.array as Float32Array),
    normals: normal ? Array.from(normal.array as Float32Array) : undefined,
    index: index ? Array.from(index.array as ArrayLike<number>) : undefined,
  };
}

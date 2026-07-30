import * as THREE from 'three';
import type { GeometryData } from '../state/types';

/**
 * Runtime caches for geometry, keyed by asset id. Geometry is heavy and is kept
 * out of the document store entirely (so undo snapshots + autosave stay small).
 * Two parallel maps:
 *   - `geomCache`: the live THREE.BufferGeometry used for rendering.
 *   - `dataCache`: the raw typed-array GeometryData used for export / persistence.
 */
const geomCache = new Map<string, THREE.BufferGeometry>();
const dataCache = new Map<string, GeometryData>();

/** Builds a THREE.BufferGeometry from typed-array data (no copying). */
export function buildGeometry(data: GeometryData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  if (data.normals && data.normals.length > 0) {
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  }
  if (data.index && data.index.length > 0) {
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Returns the cached THREE geometry for an asset id (must have been registered). */
export function getGeometry(assetId: string): THREE.BufferGeometry | undefined {
  let g = geomCache.get(assetId);
  if (!g) {
    const data = dataCache.get(assetId);
    if (!data) return undefined;
    g = buildGeometry(data);
    geomCache.set(assetId, g);
  }
  return g;
}

/** Registers both the raw data and (lazily) the THREE geometry for an asset id. */
export function putGeometryData(id: string, data: GeometryData): void {
  dataCache.set(id, data);
}

/** Registers a freshly-built THREE geometry so it doesn't need rebuilding. */
export function putGeometry(id: string, geometry: THREE.BufferGeometry): void {
  geomCache.set(id, geometry);
}

/** Returns the raw typed-array geometry data for an asset id (for export/persist). */
export function getGeometryData(id: string): GeometryData | undefined {
  return dataCache.get(id);
}

export function hasGeometry(id: string): boolean {
  return geomCache.has(id) || dataCache.has(id);
}

/** Disposes and drops the cached geometry for an asset id (call on removal). */
export function disposeGeometry(id: string): void {
  geomCache.get(id)?.dispose();
  geomCache.delete(id);
  dataCache.delete(id);
}

/** Extracts typed-array GeometryData from a BufferGeometry (no number[] copies). */
export function geometryToData(g: THREE.BufferGeometry): GeometryData {
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const index = g.getIndex();
  return {
    positions: position.array as Float32Array,
    normals: normal ? (normal.array as Float32Array) : undefined,
    index: index ? Uint32Array.from(index.array as ArrayLike<number>) : undefined,
  };
}

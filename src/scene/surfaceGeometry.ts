/**
 * Triangulated geometry for flat polygonal surfaces.
 *
 * Surface geometry is DERIVED from the document (the polygon points), not
 * imported, so it deliberately does not live in io/geometryCache.ts — that
 * cache is persisted to IndexedDB and written into `geom/<id>.bin` on export,
 * neither of which should ever hold a surface.
 */

import * as THREE from 'three';
import type { Point2 } from '../state/types';

/** Positive for counter-clockwise winding, negative for clockwise. */
export function polygonSignedArea(points: Point2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/**
 * Forces counter-clockwise winding. ShapeGeometry hardcodes +Z normals, but
 * Earcut's triangle orientation follows the contour, so a clockwise outline
 * would emit back-facing triangles under FrontSide rendering.
 */
export function normalizeWinding(points: Point2[]): Point2[] {
  return polygonSignedArea(points) < 0 ? [...points].reverse() : points;
}

export interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

export function polygonBounds(points: Point2[]): PolygonBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!points.length) {
    minX = minY = maxX = maxY = 0;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Area-weighted centroid, falling back to the bbox center for degenerate input. */
export function polygonCentroid(points: Point2[]): Point2 {
  const area = polygonSignedArea(points);
  if (Math.abs(area) < 1e-9) {
    const b = polygonBounds(points);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/**
 * Triangulates a polygon into a flat mesh on the local XY plane, with UVs
 * normalized to the polygon's bounding box so an image fits it exactly.
 * Callers own the result and must dispose it (see `getSurfaceGeometry` for the
 * cached variant).
 */
export function buildSurfaceGeometry(points: Point2[]): THREE.BufferGeometry {
  const pts = normalizeWinding(points);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geometry = new THREE.ShapeGeometry(shape);

  // ShapeGeometry's WorldUVGenerator writes UVs in raw shape coordinates (a
  // 200mm-wide polygon gets UVs spanning 0..200), so renormalize against the
  // bbox. Read from `position` rather than trusting the generator's convention.
  const { minX, minY, w, h } = polygonBounds(pts);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, (position.getX(i) - minX) / (w || 1), (position.getY(i) - minY) / (h || 1));
  }
  uv.needsUpdate = true;

  // Required: marquee selection does Box3.setFromObject and raycasting needs
  // the bounding sphere.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Cache key: points rounded to 3dp so float noise from dragging doesn't thrash. */
export function surfaceGeometryKey(points: Point2[]): string {
  return points.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(';');
}

const CACHE_LIMIT = 200;
const cache = new Map<string, THREE.BufferGeometry>();

/**
 * Cached triangulation. Live vertex dragging should use `buildSurfaceGeometry`
 * instead so a single drag doesn't evict the whole cache.
 */
export function getSurfaceGeometry(points: Point2[]): THREE.BufferGeometry {
  const key = surfaceGeometryKey(points);
  const hit = cache.get(key);
  if (hit) {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const geometry = buildSurfaceGeometry(points);
  cache.set(key, geometry);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) {
      cache.get(oldest)?.dispose();
      cache.delete(oldest);
    }
  }
  return geometry;
}

/**
 * Geometry for laying a flat surface onto a mesh face. Kept free of store
 * imports so it stays pure and testable on its own.
 */

import * as THREE from 'three';
import type { Vec3 } from '../state/types';

const r2d = THREE.MathUtils.radToDeg;

/** Gap between the host face and the surface, matching FaceHighlight's (mm). */
export const SURFACE_OFFSET = 0.5;
/** Fraction of the face's bounding rectangle the new surface covers. */
export const INSET = 0.85;

export interface FacePlacement {
  position: Vec3;
  rotation: Vec3;
  width: number;
  height: number;
}

/**
 * Frames a flat surface onto a face, given the face's vertices and normal in
 * the host's local space.
 *
 * The in-plane axes are biased toward world up rather than taken from a bare
 * `setFromUnitVectors`, which leaves an arbitrary roll when the normal is
 * antiparallel to +Z — that would drop text onto a face sideways or upside
 * down depending on nothing the user can see.
 */
export function computeFacePlacement(
  vertices: THREE.Vector3[],
  faceNormal: THREE.Vector3,
): FacePlacement | null {
  if (vertices.length < 3) return null;
  if (faceNormal.lengthSq() < 1e-8) return null;

  const normal = faceNormal.clone().normalize();
  const up =
    Math.abs(normal.z) > 0.99
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  const xAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();

  const centroid = new THREE.Vector3();
  for (const v of vertices) centroid.add(v);
  centroid.multiplyScalar(1 / vertices.length);

  // Face extents measured in the face's own basis.
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const offset = new THREE.Vector3();
  for (const v of vertices) {
    offset.copy(v).sub(centroid);
    const u = offset.dot(xAxis);
    const w = offset.dot(yAxis);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (w < minV) minV = w;
    if (w > maxV) maxV = w;
  }

  const position = centroid
    .clone()
    .addScaledVector(xAxis, (minU + maxU) / 2)
    .addScaledVector(yAxis, (minV + maxV) / 2)
    .addScaledVector(normal, SURFACE_OFFSET);

  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, yAxis, normal),
  );
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');

  return {
    position: [position.x, position.y, position.z],
    rotation: [r2d(euler.x), r2d(euler.y), r2d(euler.z)],
    width: Math.max(1, (maxU - minU) * INSET),
    height: Math.max(1, (maxV - minV) * INSET),
  };
}

/**
 * The unique vertices of a face, in the mesh's local space, offset by the
 * mesh's own position so the result is in the host group's frame.
 */
export function faceVertices(
  geometry: THREE.BufferGeometry,
  triangles: number[],
  offset: THREE.Vector3,
): THREE.Vector3[] {
  const position = geometry.getAttribute('position');
  if (!position) return [];
  const index = geometry.getIndex();
  const seen = new Set<number>();
  const vertices: THREE.Vector3[] = [];
  for (const tri of triangles) {
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(tri * 3 + k) : tri * 3 + k;
      if (seen.has(i)) continue;
      seen.add(i);
      vertices.push(new THREE.Vector3().fromBufferAttribute(position, i).add(offset));
    }
  }
  return vertices;
}

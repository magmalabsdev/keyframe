/**
 * Normal-attribute validation and repair.
 *
 * Loaders don't agree on normal quality. STLLoader in particular ALWAYS writes
 * a normal attribute, copying each facet's normal straight out of the file —
 * including all-zero ones, which are legal (the normal is redundant with the
 * vertex winding, so plenty of exporters emit `facet normal 0 0 0`). A
 * zero-length normal makes N·L zero for every light, so the surface renders
 * pure black at any color from any angle. Checking "is the attribute present"
 * is therefore not enough; the values have to be usable.
 */
import * as THREE from 'three';

/** Below this squared length a normal can't be normalized into a direction. */
const MIN_LENGTH_SQ = 1e-12;

/** True when every normal is finite and non-degenerate (usable for shading). */
export function hasUsableNormals(normals: ArrayLike<number>): boolean {
  // Full scan, not a sample: the case sampling misses is a file with one bad
  // facet among good ones, whose symptom is an invisible black patch. This is
  // an allocation-free linear pass run once per asset, and the common
  // all-zero case exits on the first triple.
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const lenSq = x * x + y * y + z * z;
    if (!(lenSq > MIN_LENGTH_SQ) || !Number.isFinite(lenSq)) return false;
  }
  return true;
}

/**
 * Recomputes vertex normals when the geometry's are missing, mismatched, or
 * degenerate. Returns whether a repair happened.
 *
 * For non-indexed geometry (what STL produces) this yields flat per-face
 * normals, which is the correct look for a faceted mesh.
 */
export function ensureNormals(geometry: THREE.BufferGeometry): boolean {
  const normal = geometry.getAttribute('normal');
  const position = geometry.getAttribute('position');
  if (normal) {
    const sized = !position || normal.count === position.count;
    if (sized && hasUsableNormals(normal.array as ArrayLike<number>)) return false;
    // computeVertexNormals() reuses whatever attribute is already there, so a
    // wrong-sized one has to go; a correctly-sized one is rewritten in place
    // (which is what lets buildGeometry heal the caller's stored array).
    if (!sized) geometry.deleteAttribute('normal');
  }
  geometry.computeVertexNormals();
  return true;
}

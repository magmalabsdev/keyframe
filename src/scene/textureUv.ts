import * as THREE from 'three';

/**
 * Projects a vertex position onto the two axes perpendicular to the dominant
 * axis of its normal (box/cube projection). Returns raw mm offsets from
 * `bbox.min` along those two axes.
 */
function projectVertex(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  normal: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  bbox: THREE.Box3,
  i: number,
): { u: number; v: number } {
  const x = position.getX(i);
  const y = position.getY(i);
  const z = position.getZ(i);
  const nx = Math.abs(normal.getX(i));
  const ny = Math.abs(normal.getY(i));
  const nz = Math.abs(normal.getZ(i));

  if (nx >= ny && nx >= nz) {
    return { u: y - bbox.min.y, v: z - bbox.min.z };
  } else if (ny >= nx && ny >= nz) {
    return { u: x - bbox.min.x, v: z - bbox.min.z };
  } else {
    return { u: x - bbox.min.x, v: y - bbox.min.y };
  }
}

/**
 * Generates UVs via cube/box projection so any geometry (including UV-less
 * STL imports) can have an image wrapped onto all of its faces. For each
 * vertex, projects its position onto the two axes perpendicular to the
 * dominant axis of its normal, normalized to the geometry's bounding box.
 *
 * Idempotent and cached per geometry via `geometry.userData`.
 */
export function ensureBoxUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.userData.__boxUV) return;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const size = new THREE.Vector3().subVectors(bbox.max, bbox.min);
  if (size.x === 0) size.x = 1;
  if (size.y === 0) size.y = 1;
  if (size.z === 0) size.z = 1;

  const position = geometry.getAttribute('position');
  let normal = geometry.getAttribute('normal');
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute('normal');
  }

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const { u, v } = projectVertex(position, normal, bbox, i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let sizeU: number;
    let sizeV: number;
    if (nx >= ny && nx >= nz) {
      sizeU = size.y;
      sizeV = size.z;
    } else if (ny >= nx && ny >= nz) {
      sizeU = size.x;
      sizeV = size.z;
    } else {
      sizeU = size.x;
      sizeV = size.y;
    }

    uv[i * 2] = u / sizeU;
    uv[i * 2 + 1] = v / sizeV;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.userData.__boxUV = true;
}

/**
 * Generates a second UV set (`uv1`) for "tile" texture mapping, using the
 * same box-projection axis selection as `ensureBoxUVs` but expressed in raw
 * mm offsets from the bounding box minimum rather than normalized to [0,1].
 * This lets a texture repeat at a consistent physical scale across faces of
 * different sizes.
 *
 * Idempotent and cached per geometry via `geometry.userData`.
 */
export function ensureTileUVs(geometry: THREE.BufferGeometry): void {
  if (geometry.userData.__tileUV) return;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;

  const position = geometry.getAttribute('position');
  let normal = geometry.getAttribute('normal');
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute('normal');
  }

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const { u, v } = projectVertex(position, normal, bbox, i);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  geometry.userData.__tileUV = true;
}

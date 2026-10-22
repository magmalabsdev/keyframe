import * as THREE from 'three';
import { ensureNormals } from './normals';
import { geometryToData } from './geometryCache';
import type { LoadedPart } from './loaders';

/** glTF (by spec) and most FBX files are Y-up; the scene is Z-up. */
const Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);

/**
 * Copies an attribute into a plain Float32 attribute. Interleaved, quantized
 * (KHR_mesh_quantization) or normalized integer attributes would otherwise lose
 * precision — or be skipped by `.array` readers — once transformed.
 */
function toFloat32(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return new THREE.BufferAttribute(out, 3);
}

/** Reverses triangle winding (needed after a mirroring transform). */
function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.getIndex();
  if (index) {
    const a = index.array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
    const a = attr.array;
    const s = attr.itemSize;
    for (let v = 0; v + 2 < attr.count; v += 3) {
      for (let k = 0; k < s; k++) {
        const t = a[(v + 1) * s + k];
        a[(v + 1) * s + k] = a[(v + 2) * s + k];
        a[(v + 2) * s + k] = t;
      }
    }
  }
}

function materialColor(material: THREE.Material | THREE.Material[]): string | undefined {
  const m = (Array.isArray(material) ? material[0] : material) as
    | (THREE.Material & { color?: THREE.Color })
    | undefined;
  return m?.color?.isColor ? '#' + m.color.getHexString() : undefined;
}

/**
 * Splits a loaded scene graph (glTF / FBX) into one part per mesh, with world
 * transforms baked in and converted from Y-up to Z-up. Geometry stays indexed;
 * only position + normal are kept. Names fall back to `baseName` and are
 * de-duplicated so every object in the outliner is distinguishable.
 */
export function extractParts(root: THREE.Object3D, baseName: string): LoadedPart[] {
  root.updateMatrixWorld(true);
  const parts: LoadedPart[] = [];
  const nameCounts = new Map<string, number>();
  const matrix = new THREE.Matrix4();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    const src = mesh.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', toFloat32(src.getAttribute('position')));
    const normal = src.getAttribute('normal');
    if (normal) g.setAttribute('normal', toFloat32(normal));
    const index = src.getIndex();
    if (index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(index.array as ArrayLike<number>), 1));

    matrix.multiplyMatrices(Y_UP_TO_Z_UP, mesh.matrixWorld);
    g.applyMatrix4(matrix);
    if (matrix.determinant() < 0) flipWinding(g);
    ensureNormals(g);

    const base = mesh.name.trim() || baseName;
    const count = (nameCounts.get(base) ?? 0) + 1;
    nameCounts.set(base, count);
    parts.push({
      name: count === 1 ? base : `${base} ${count}`,
      color: materialColor(mesh.material),
      data: geometryToData(g),
    });
  });

  if (parts.length === 0) throw new Error('No mesh geometry found in file');
  return parts;
}

/** Center all parts together: combined bbox centered in XY, resting on z=0. */
export function centerParts(parts: Array<{ positions: Float32Array }>): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    const a = p.positions;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < minX) minX = a[i];
      if (a[i] > maxX) maxX = a[i];
      if (a[i + 1] < minY) minY = a[i + 1];
      if (a[i + 1] > maxY) maxY = a[i + 1];
      if (a[i + 2] < minZ) minZ = a[i + 2];
    }
  }
  if (!Number.isFinite(minX)) return;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of parts) {
    const a = p.positions;
    for (let i = 0; i < a.length; i += 3) {
      a[i] -= cx;
      a[i + 1] -= cy;
      a[i + 2] -= minZ;
    }
  }
}

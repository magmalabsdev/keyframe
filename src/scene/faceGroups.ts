import * as THREE from 'three';

const POS_EPS = 1e-4;
const NORMAL_DOT_THRESHOLD = 0.999;

/** Per-geometry cache: triangle index -> all triangle indices in its planar face group. */
const cache = new WeakMap<THREE.BufferGeometry, number[][]>();

function keyFor(v: THREE.Vector3): string {
  return `${Math.round(v.x / POS_EPS)},${Math.round(v.y / POS_EPS)},${Math.round(v.z / POS_EPS)}`;
}

function buildFaceGroups(geometry: THREE.BufferGeometry): number[][] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : position.count / 3;

  const triVerts: THREE.Vector3[][] = [];
  const triNormals: THREE.Vector3[] = [];
  const vertKeyToTris = new Map<string, number[]>();

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const a = new THREE.Vector3().fromBufferAttribute(position, i0);
    const b = new THREE.Vector3().fromBufferAttribute(position, i1);
    const c = new THREE.Vector3().fromBufferAttribute(position, i2);
    triVerts.push([a, b, c]);
    const normal = new THREE.Vector3()
      .subVectors(c, b)
      .cross(new THREE.Vector3().subVectors(a, b))
      .normalize();
    triNormals.push(normal);
    for (const v of [a, b, c]) {
      const key = keyFor(v);
      let list = vertKeyToTris.get(key);
      if (!list) {
        list = [];
        vertKeyToTris.set(key, list);
      }
      list.push(t);
    }
  }

  // Adjacency: triangles sharing an edge (>=2 vertices) with a near-identical normal.
  const adjacency: Set<number>[] = Array.from({ length: triCount }, () => new Set<number>());
  for (let t = 0; t < triCount; t++) {
    const verts = triVerts[t];
    const keys = verts.map(keyFor);
    const candidates = new Set<number>();
    for (const key of keys) {
      const list = vertKeyToTris.get(key);
      if (list) for (const other of list) if (other !== t) candidates.add(other);
    }
    for (const other of candidates) {
      if (triNormals[t].dot(triNormals[other]) <= NORMAL_DOT_THRESHOLD) continue;
      const otherKeys = triVerts[other].map(keyFor);
      let shared = 0;
      for (const key of keys) if (otherKeys.includes(key)) shared++;
      if (shared >= 2) {
        adjacency[t].add(other);
        adjacency[other].add(t);
      }
    }
  }

  // BFS to group connected, coplanar triangles.
  const groupId = new Array<number>(triCount).fill(-1);
  const groups: number[][] = [];
  for (let t = 0; t < triCount; t++) {
    if (groupId[t] !== -1) continue;
    const id = groups.length;
    const group: number[] = [];
    const queue = [t];
    groupId[t] = id;
    while (queue.length) {
      const cur = queue.pop()!;
      group.push(cur);
      for (const n of adjacency[cur]) {
        if (groupId[n] === -1) {
          groupId[n] = id;
          queue.push(n);
        }
      }
    }
    groups.push(group);
  }

  const result: number[][] = new Array(triCount);
  for (let t = 0; t < triCount; t++) result[t] = groups[groupId[t]];
  return result;
}

/** Returns the indices of all triangles forming the same planar face as `faceIndex`. */
export function getFaceTriangles(geometry: THREE.BufferGeometry, faceIndex: number): number[] {
  let groups = cache.get(geometry);
  if (!groups) {
    groups = buildFaceGroups(geometry);
    cache.set(geometry, groups);
  }
  return groups[faceIndex] ?? [faceIndex];
}

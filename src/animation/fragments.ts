import * as THREE from 'three';
import type { Asset, TransitionType } from '../state/types';
import { getGeometry } from '../io/geometryCache';

/**
 * Builds the "fragmented" geometry for a form transition (voxel / particle /
 * polygon). The geometry merges many small chunks and carries, per vertex, the
 * attributes the fragment shader needs to scatter/assemble each chunk:
 *   aCentroid - the chunk's anchor point (it rotates/scatters around this)
 *   aOffset   - the outward displacement applied when fully scattered
 *   aAxis     - unit spin axis
 *   aAngle    - spin angle applied when fully scattered
 * At progress 1 every chunk sits exactly at its home pose.
 *
 * Generation is expensive, so results are cached per asset+form+density+fill.
 */
const cache = new Map<string, THREE.BufferGeometry>();

export type FormType = 'voxel form' | 'particle form' | 'polygon form';

function keyFor(
  assetId: string,
  form: FormType,
  density: number,
  solidFill: boolean,
): string {
  return `${assetId}:${form}:${density.toFixed(3)}:${solidFill ? 1 : 0}`;
}

/** Small deterministic PRNG so a given asset+config always fragments the same way. */
function makeRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Builder {
  position: number[];
  normal: number[];
  aCentroid: number[];
  aOffset: number[];
  aAxis: number[];
  aAngle: number[];
}

const newBuilder = (): Builder => ({
  position: [],
  normal: [],
  aCentroid: [],
  aOffset: [],
  aAxis: [],
  aAngle: [],
});

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Pseudo-random unit vector. */
function randomAxis(rng: () => number, out: THREE.Vector3): THREE.Vector3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), r * Math.sin(a), z);
}

const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();

/**
 * Appends one chunk's triangles to the builder. `pos`/`norm` are flat local
 * triangle data (length = 9 * triCount). The chunk's scatter parameters are
 * derived from its centroid relative to the mesh center.
 */
function addChunk(
  b: Builder,
  pos: ArrayLike<number>,
  norm: ArrayLike<number>,
  cx: number,
  cy: number,
  cz: number,
  meshCenter: THREE.Vector3,
  maxDim: number,
  rng: () => number,
): void {
  _c.set(cx, cy, cz);
  _dir.copy(_c).sub(meshCenter);
  if (_dir.lengthSq() < 1e-6) randomAxis(rng, _dir);
  else _dir.normalize();
  // Outward scatter + a little tangential jitter.
  const dist = maxDim * lerp(0.5, 1.5, rng());
  const ox = _dir.x * dist + (rng() - 0.5) * maxDim * 0.4;
  const oy = _dir.y * dist + (rng() - 0.5) * maxDim * 0.4;
  const oz = _dir.z * dist + (rng() - 0.5) * maxDim * 0.4;
  randomAxis(rng, _axis);
  const angle = (rng() * 2 - 1) * Math.PI * 3;

  const vertCount = pos.length / 3;
  for (let i = 0; i < vertCount; i++) {
    b.position.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    b.normal.push(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]);
    b.aCentroid.push(cx, cy, cz);
    b.aOffset.push(ox, oy, oz);
    b.aAxis.push(_axis.x, _axis.y, _axis.z);
    b.aAngle.push(angle);
  }
}

function buildGeometry(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normal, 3));
  g.setAttribute('aCentroid', new THREE.Float32BufferAttribute(b.aCentroid, 3));
  g.setAttribute('aOffset', new THREE.Float32BufferAttribute(b.aOffset, 3));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(b.aAxis, 3));
  g.setAttribute('aAngle', new THREE.Float32BufferAttribute(b.aAngle, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Iterates triangles of a geometry as flat [ax,ay,az, bx,by,bz, cx,cy,cz]. */
function forEachTriangle(
  geo: THREE.BufferGeometry,
  cb: (t: Float32Array) => void,
): void {
  const posAttr = geo.getAttribute('position');
  const pos = posAttr.array as ArrayLike<number>;
  const index = geo.getIndex();
  const tri = new Float32Array(9);
  const emit = (a: number, b: number, c: number) => {
    for (let k = 0; k < 3; k++) tri[k] = pos[a * 3 + k];
    for (let k = 0; k < 3; k++) tri[3 + k] = pos[b * 3 + k];
    for (let k = 0; k < 3; k++) tri[6 + k] = pos[c * 3 + k];
    cb(tri);
  };
  if (index) {
    const idx = index.array as ArrayLike<number>;
    for (let i = 0; i < idx.length; i += 3) emit(idx[i], idx[i + 1], idx[i + 2]);
  } else {
    for (let i = 0; i < posAttr.count; i += 3) emit(i, i + 1, i + 2);
  }
}

function triNormal(t: Float32Array, out: number[]): void {
  const ux = t[3] - t[0],
    uy = t[4] - t[1],
    uz = t[5] - t[2];
  const vx = t[6] - t[0],
    vy = t[7] - t[1],
    vz = t[8] - t[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
}

// ---- Unit chunk templates (non-indexed) -----------------------------------
const boxTemplate = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  return {
    pos: g.getAttribute('position').array as Float32Array,
    norm: g.getAttribute('normal').array as Float32Array,
  };
})();
const sphereTemplate = (() => {
  const g = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  return {
    pos: g.getAttribute('position').array as Float32Array,
    norm: g.getAttribute('normal').array as Float32Array,
  };
})();

function scaledTemplate(
  template: { pos: Float32Array; norm: Float32Array },
  s: number,
  cx: number,
  cy: number,
  cz: number,
): { pos: Float32Array } {
  const out = new Float32Array(template.pos.length);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = template.pos[i] * s + cx;
    out[i + 1] = template.pos[i + 1] * s + cy;
    out[i + 2] = template.pos[i + 2] * s + cz;
  }
  return { pos: out };
}

/** Point-in-mesh test via +X ray parity. `mesh` must have up-to-date geometry. */
function makeInsideTest(geo: THREE.BufferGeometry): (p: THREE.Vector3) => boolean {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3(1, 0, 0);
  return (p: THREE.Vector3) => {
    ray.set(p, dir);
    ray.far = Infinity;
    const hits = ray.intersectObject(mesh, false);
    return hits.length % 2 === 1;
  };
}

// ---- Per-form generators ---------------------------------------------------

function buildVoxel(
  geo: THREE.BufferGeometry,
  bbox: THREE.Box3,
  maxDim: number,
  density: number,
  solidFill: boolean,
  rng: () => number,
): Builder {
  const b = newBuilder();
  const res = Math.round(lerp(6, 30, clamp01(density)));
  const cell = maxDim / res;
  const center = bbox.getCenter(new THREE.Vector3());
  const occupied = new Set<string>();
  const key = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;
  const cellOf = (x: number, n0: number) => Math.floor((x - n0) / cell);

  // Shell: mark every cell a triangle passes through (barycentric sampling).
  forEachTriangle(geo, (t) => {
    const e1 = Math.hypot(t[3] - t[0], t[4] - t[1], t[5] - t[2]);
    const e2 = Math.hypot(t[6] - t[0], t[7] - t[1], t[8] - t[2]);
    const steps = Math.max(1, Math.ceil(Math.max(e1, e2) / cell));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const px = t[0] + (t[3] - t[0]) * u + (t[6] - t[0]) * v;
        const py = t[1] + (t[4] - t[1]) * u + (t[7] - t[1]) * v;
        const pz = t[2] + (t[5] - t[2]) * u + (t[8] - t[2]) * v;
        occupied.add(key(cellOf(px, bbox.min.x), cellOf(py, bbox.min.y), cellOf(pz, bbox.min.z)));
      }
    }
  });

  // Solid: also fill interior cells via an inside test.
  if (solidFill) {
    const inside = makeInsideTest(geo);
    const p = new THREE.Vector3();
    const nx = Math.min(res, 24);
    for (let ix = 0; ix <= nx; ix++) {
      for (let iy = 0; iy <= nx; iy++) {
        for (let iz = 0; iz <= nx; iz++) {
          const k = key(ix, iy, iz);
          if (occupied.has(k)) continue;
          p.set(
            bbox.min.x + (ix + 0.5) * cell,
            bbox.min.y + (iy + 0.5) * cell,
            bbox.min.z + (iz + 0.5) * cell,
          );
          if (inside(p)) occupied.add(k);
        }
      }
    }
  }

  const size = cell * 0.92;
  for (const k of occupied) {
    const [ix, iy, iz] = k.split(',').map(Number);
    const cx = bbox.min.x + (ix + 0.5) * cell;
    const cy = bbox.min.y + (iy + 0.5) * cell;
    const cz = bbox.min.z + (iz + 0.5) * cell;
    const cube = scaledTemplate(boxTemplate, size, cx, cy, cz);
    addChunk(b, cube.pos, boxTemplate.norm, cx, cy, cz, center, maxDim, rng);
  }
  return b;
}

function buildParticle(
  geo: THREE.BufferGeometry,
  bbox: THREE.Box3,
  maxDim: number,
  density: number,
  solidFill: boolean,
  rng: () => number,
): Builder {
  const b = newBuilder();
  const n = Math.round(lerp(120, 2000, clamp01(density)));

  // Cumulative-area table for area-weighted surface sampling.
  const tris: Float32Array[] = [];
  const cum: number[] = [];
  let total = 0;
  forEachTriangle(geo, (t) => {
    const ux = t[3] - t[0],
      uy = t[4] - t[1],
      uz = t[5] - t[2];
    const vx = t[6] - t[0],
      vy = t[7] - t[1],
      vz = t[8] - t[2];
    const cxn = uy * vz - uz * vy;
    const cyn = uz * vx - ux * vz;
    const czn = ux * vy - uy * vx;
    total += 0.5 * Math.hypot(cxn, cyn, czn);
    tris.push(t.slice());
    cum.push(total);
  });
  if (tris.length === 0) return b;

  const pickTri = (r: number) => {
    let lo = 0;
    let hi = cum.length - 1;
    const target = r * total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return tris[lo];
  };

  // Particle radius scales so chunks stay small relative to the part.
  const radius = (maxDim / Math.cbrt(n)) * 0.35;
  const center = bbox.getCenter(new THREE.Vector3());

  const emitAt = (x: number, y: number, z: number) => {
    const sph = scaledTemplate(sphereTemplate, radius, x, y, z);
    addChunk(b, sph.pos, sphereTemplate.norm, x, y, z, center, maxDim, rng);
  };

  for (let i = 0; i < n; i++) {
    const t = pickTri(rng());
    let u = rng();
    let v = rng();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    emitAt(
      t[0] + (t[3] - t[0]) * u + (t[6] - t[0]) * v,
      t[1] + (t[4] - t[1]) * u + (t[7] - t[1]) * v,
      t[2] + (t[5] - t[2]) * u + (t[8] - t[2]) * v,
    );
  }

  if (solidFill) {
    const inside = makeInsideTest(geo);
    const p = new THREE.Vector3();
    const size = bbox.getSize(new THREE.Vector3());
    let placed = 0;
    let attempts = 0;
    const want = n;
    const maxAttempts = n * 40;
    while (placed < want && attempts < maxAttempts) {
      attempts++;
      p.set(
        bbox.min.x + rng() * size.x,
        bbox.min.y + rng() * size.y,
        bbox.min.z + rng() * size.z,
      );
      if (inside(p)) {
        emitAt(p.x, p.y, p.z);
        placed++;
      }
    }
  }
  return b;
}

function buildPolygon(
  geo: THREE.BufferGeometry,
  bbox: THREE.Box3,
  maxDim: number,
  density: number,
  rng: () => number,
): Builder {
  const b = newBuilder();
  // Cluster triangles into buckets on a coarse grid; low density = bigger shards.
  const clusters = Math.round(lerp(2, 22, clamp01(density)));
  const cell = maxDim / clusters;
  const center = bbox.getCenter(new THREE.Vector3());
  const buckets = new Map<string, { pos: number[]; norm: number[]; sx: number; sy: number; sz: number; n: number }>();
  const nrm: number[] = [0, 0, 0];

  forEachTriangle(geo, (t) => {
    const ccx = (t[0] + t[3] + t[6]) / 3;
    const ccy = (t[1] + t[4] + t[7]) / 3;
    const ccz = (t[2] + t[5] + t[8]) / 3;
    const k = `${Math.floor((ccx - bbox.min.x) / cell)},${Math.floor((ccy - bbox.min.y) / cell)},${Math.floor((ccz - bbox.min.z) / cell)}`;
    let bk = buckets.get(k);
    if (!bk) {
      bk = { pos: [], norm: [], sx: 0, sy: 0, sz: 0, n: 0 };
      buckets.set(k, bk);
    }
    triNormal(t, nrm);
    for (let i = 0; i < 9; i++) bk.pos.push(t[i]);
    for (let i = 0; i < 3; i++) {
      bk.norm.push(nrm[0], nrm[1], nrm[2]);
    }
    bk.sx += ccx;
    bk.sy += ccy;
    bk.sz += ccz;
    bk.n += 1;
  });

  for (const bk of buckets.values()) {
    addChunk(
      b,
      bk.pos,
      bk.norm,
      bk.sx / bk.n,
      bk.sy / bk.n,
      bk.sz / bk.n,
      center,
      maxDim,
      rng,
    );
  }
  return b;
}

/** Returns the cached fragmented geometry for an asset + form transition config. */
export function getFragmentGeometry(
  asset: Asset,
  form: FormType,
  density: number,
  solidFill: boolean,
): THREE.BufferGeometry {
  const k = keyFor(asset.id, form, density, solidFill);
  const hit = cache.get(k);
  if (hit) return hit;

  const src = getGeometry(asset.id);
  if (!src) throw new Error(`No geometry for asset ${asset.id}`);
  const bbox = src.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
    src.getAttribute('position') as THREE.BufferAttribute,
  );
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const rng = makeRng(k);

  let builder: Builder;
  if (form === 'voxel form') builder = buildVoxel(src, bbox, maxDim, density, solidFill, rng);
  else if (form === 'particle form') builder = buildParticle(src, bbox, maxDim, density, solidFill, rng);
  else builder = buildPolygon(src, bbox, maxDim, density, rng);

  const geo = buildGeometry(builder);
  cache.set(k, geo);
  return geo;
}

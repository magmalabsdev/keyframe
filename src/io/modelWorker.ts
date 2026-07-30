/// <reference lib="webworker" />
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ensureNormals } from './normals';

/** A parsed part shipped back to the main thread as transferable typed arrays. */
export interface WorkerPart {
  name: string;
  color?: string;
  positions: Float32Array;
  normals?: Float32Array;
  index?: Uint32Array;
}

export interface WorkerRequest {
  reqId: number;
  /** Lowercase file extension: stl | obj | step | stp. */
  kind: string;
  name: string;
  buffer: ArrayBuffer;
  /** 0..1 tessellation quality for STEP (higher = finer). */
  quality: number;
}

export type WorkerResponse =
  | {
      reqId: number;
      ok: true;
      format: string;
      /** One chunk of parts. Large assemblies stream several of these. */
      parts: WorkerPart[];
      /** Parts posted so far (including this chunk) and the grand total. */
      loaded: number;
      total: number;
      /** True on the final chunk. */
      done: boolean;
    }
  | { reqId: number; ok: false; error: string };

/** Post parts back in chunks so the main thread can mount an assembly
 * progressively (and show a count) instead of committing it all at once. */
const STREAM_CHUNK = 100;

// ---- Shared geometry helpers (worker-side copies of the old main-thread logic) ----

function mergeObject3D(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    }
    if (g.index) g = g.toNonIndexed();
    // Repair per geometry before merging so every input has the same attributes.
    ensureNormals(g);
    geometries.push(g);
  });
  if (geometries.length === 0) throw new Error('No mesh geometry found in file');
  return geometries.length === 1
    ? geometries[0]
    : BufferGeometryUtils.mergeGeometries(geometries, false);
}

function toPart(name: string, g: THREE.BufferGeometry, color?: string): WorkerPart {
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const index = g.getIndex();
  return {
    name,
    color,
    positions: Float32Array.from(position.array as ArrayLike<number>),
    normals: normal ? Float32Array.from(normal.array as ArrayLike<number>) : undefined,
    index: index ? Uint32Array.from(index.array as ArrayLike<number>) : undefined,
  };
}

/** Center all parts together: combined bbox centered in XY, resting on z=0. */
function centerParts(parts: WorkerPart[]): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const a = p.positions;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < minX) minX = a[i];
      if (a[i] > maxX) maxX = a[i];
      if (a[i + 1] < minY) minY = a[i + 1];
      if (a[i + 1] > maxY) maxY = a[i + 1];
      if (a[i + 2] < minZ) minZ = a[i + 2];
      if (a[i + 2] > maxZ) maxZ = a[i + 2];
    }
  }
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

// ---- STEP (occt-import-js) ----

function occtColorToHex(c?: ArrayLike<number> | null): string | undefined {
  if (!c || c.length < 3) return undefined;
  return '#' + new THREE.Color(c[0], c[1], c[2]).getHexString();
}

function pickStepColor(mesh: import('occt-import-js').OcctMesh): string | undefined {
  const faces = mesh.brep_faces;
  if (faces && faces.length > 0) {
    const coverage = new Map<string, { weight: number; color: number[] }>();
    for (const f of faces) {
      if (!f.color) continue;
      const key = f.color.join(',');
      const weight = Math.max(1, f.last - f.first + 1);
      const entry = coverage.get(key);
      if (entry) entry.weight += weight;
      else coverage.set(key, { weight, color: f.color });
    }
    let best: { weight: number; color: number[] } | undefined;
    for (const entry of coverage.values()) {
      if (!best || entry.weight > best.weight) best = entry;
    }
    if (best) return occtColorToHex(best.color);
  }
  return occtColorToHex(mesh.color);
}

async function loadStep(
  buffer: ArrayBuffer,
  baseName: string,
  quality: number,
): Promise<WorkerPart[]> {
  const wasmUrl = (await import('occt-import-js/dist/occt-import-js.wasm?url')).default;
  const mod = (await import('occt-import-js')) as unknown as Record<string, unknown>;
  const candidate =
    (typeof mod === 'function' && mod) ||
    (typeof mod.default === 'function' && mod.default) ||
    (mod.default &&
      typeof (mod.default as Record<string, unknown>).default === 'function' &&
      (mod.default as Record<string, unknown>).default);
  if (typeof candidate !== 'function') throw new Error('Could not resolve occt-import-js factory');
  const occtFactory = candidate as (opts: {
    locateFile?: (p: string) => string;
  }) => Promise<import('occt-import-js').OcctModule>;
  const occt = await occtFactory({ locateFile: () => wasmUrl });

  const q = Math.max(0, Math.min(1, quality));
  // Finer deflection = smoother + more triangles. Map quality across a sane range.
  const params = {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.01 * (1 - q) + 0.0005 * q,
    angularDeflection: 0.8 * (1 - q) + 0.2 * q,
  } as unknown as null;

  const result = occt.ReadStepFile(new Uint8Array(buffer), params);
  if (!result || !result.success || !result.meshes?.length) {
    throw new Error('Failed to parse STEP file');
  }

  return result.meshes.map((mesh, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3),
    );
    if (mesh.attributes.normal) {
      g.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3),
      );
    }
    // Keep the geometry indexed (no toNonIndexed) to avoid ~3x vertex inflation.
    if (mesh.index) g.setIndex(Array.from(mesh.index.array));
    ensureNormals(g);
    // Append an index so duplicate solid names (often all "SOLID") stay unique.
    return toPart(`${mesh.name?.trim() || baseName} ${i + 1}`, g, pickStepColor(mesh));
  });
}

async function parse(req: WorkerRequest): Promise<{ format: string; parts: WorkerPart[] }> {
  const { kind, name, buffer, quality } = req;
  switch (kind) {
    case 'stl': {
      const g = new STLLoader().parse(buffer);
      // STLLoader always writes a normal attribute, copying the file's facet
      // normals verbatim — including all-zero ones, which shade to black.
      ensureNormals(g);
      return { format: 'stl', parts: [toPart(name, g)] };
    }
    case 'obj': {
      const text = new TextDecoder().decode(buffer);
      return { format: 'obj', parts: [toPart(name, mergeObject3D(new OBJLoader().parse(text)))] };
    }
    case 'step':
    case 'stp':
      return { format: 'step', parts: await loadStep(buffer, name, quality) };
    default:
      throw new Error(`Unsupported worker file type: .${kind}`);
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const { format, parts } = await parse(req);
    centerParts(parts);
    const total = parts.length;
    // Stream chunks back as separate messages; each is its own event-loop task
    // on the main thread, so the scene can mount + repaint between chunks.
    for (let i = 0; i < total; i += STREAM_CHUNK) {
      const chunk = parts.slice(i, i + STREAM_CHUNK);
      const loaded = Math.min(i + STREAM_CHUNK, total);
      const transfer: ArrayBuffer[] = [];
      for (const p of chunk) {
        transfer.push(p.positions.buffer as ArrayBuffer);
        if (p.normals) transfer.push(p.normals.buffer as ArrayBuffer);
        if (p.index) transfer.push(p.index.buffer as ArrayBuffer);
      }
      const res: WorkerResponse = {
        reqId: req.reqId,
        ok: true,
        format,
        parts: chunk,
        loaded,
        total,
        done: loaded >= total,
      };
      (self as unknown as Worker).postMessage(res, transfer);
    }
  } catch (err) {
    const res: WorkerResponse = {
      reqId: req.reqId,
      ok: false,
      error: (err as Error).message,
    };
    (self as unknown as Worker).postMessage(res);
  }
};

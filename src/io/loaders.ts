import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelFormat } from '../state/types';

export interface LoadedPart {
  name: string;
  geometry: THREE.BufferGeometry;
  /** Hex color from the source file, if any (e.g. STEP face/solid colors). */
  color?: string;
}

export interface LoadedModel {
  format: ModelFormat;
  parts: LoadedPart[];
}

export const SUPPORTED_EXTENSIONS = ['stl', 'obj', 'gltf', 'glb', 'step', 'stp'];

/** Flatten an Object3D tree into a single merged geometry in world space. */
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
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    geometries.push(g);
  });
  if (geometries.length === 0) {
    throw new Error('No mesh geometry found in file');
  }
  return geometries.length === 1
    ? geometries[0]
    : BufferGeometryUtils.mergeGeometries(geometries, false);
}

/**
 * Center all parts together on the build plate: the combined bounding box is
 * centered in XY and rests on z = 0, preserving the parts' relative arrangement.
 */
function centerParts(parts: LoadedPart[]): void {
  const bb = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    bb.union(p.geometry.boundingBox!);
  }
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const minZ = bb.min.z;
  for (const p of parts) {
    p.geometry.translate(-cx, -cy, -minZ);
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
  }
}

function occtColorToHex(c?: ArrayLike<number> | null): string | undefined {
  if (!c || c.length < 3) return undefined;
  return '#' + new THREE.Color(c[0], c[1], c[2]).getHexString();
}

/**
 * A representative color for a STEP solid. Colors can live on the mesh (uniform)
 * or per brep face; when per-face, mesh.color is a default gray. Prefer the
 * dominant (most triangle coverage) non-null face color, else the mesh color.
 */
function pickStepColor(
  mesh: import('occt-import-js').OcctMesh,
): string | undefined {
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

async function loadGltf(file: File, ext: string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  const data: ArrayBuffer | string =
    ext === 'glb' ? await file.arrayBuffer() : await file.text();
  const gltf = await loader.parseAsync(data as ArrayBuffer, '');
  return mergeObject3D(gltf.scene);
}

/** STEP imports each solid as its own part, carrying its file color. */
async function loadStep(file: File, baseName: string): Promise<LoadedPart[]> {
  // OpenCascade WASM is several MB; load it only when a STEP file is imported.
  const wasmUrl = (
    await import('occt-import-js/dist/occt-import-js.wasm?url')
  ).default;
  // occt-import-js is a UMD module; resolve the factory across interop shapes.
  const mod = (await import('occt-import-js')) as unknown as Record<string, unknown>;
  const candidate =
    (typeof mod === 'function' && mod) ||
    (typeof mod.default === 'function' && mod.default) ||
    (mod.default &&
      typeof (mod.default as Record<string, unknown>).default === 'function' &&
      (mod.default as Record<string, unknown>).default);
  if (typeof candidate !== 'function') {
    throw new Error('Could not resolve occt-import-js factory');
  }
  const occtFactory = candidate as (opts: {
    locateFile?: (p: string) => string;
  }) => Promise<import('occt-import-js').OcctModule>;
  const occt = await occtFactory({ locateFile: () => wasmUrl });

  const buffer = new Uint8Array(await file.arrayBuffer());
  const result = occt.ReadStepFile(buffer, null);
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
    if (mesh.index) g.setIndex(Array.from(mesh.index.array));
    const geometry = g.index ? g.toNonIndexed() : g;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return {
      // Append an index so duplicate solid names (often all "SOLID") stay unique.
      name: `${mesh.name?.trim() || baseName} ${i + 1}`,
      geometry,
      color: pickStepColor(mesh),
    };
  });
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported';

  let parts: LoadedPart[];
  let format: ModelFormat;

  switch (ext) {
    case 'stl': {
      const buf = await file.arrayBuffer();
      const geometry = new STLLoader().parse(buf);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      parts = [{ name, geometry }];
      format = 'stl';
      break;
    }
    case 'obj': {
      const text = await file.text();
      parts = [{ name, geometry: mergeObject3D(new OBJLoader().parse(text)) }];
      format = 'obj';
      break;
    }
    case 'gltf':
    case 'glb': {
      parts = [{ name, geometry: await loadGltf(file, ext) }];
      format = ext === 'glb' ? 'glb' : 'gltf';
      break;
    }
    case 'step':
    case 'stp': {
      parts = await loadStep(file, name);
      format = 'step';
      break;
    }
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }

  centerParts(parts);
  return { format, parts };
}

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelFormat } from '../state/types';

export interface LoadedModel {
  name: string;
  format: ModelFormat;
  geometry: THREE.BufferGeometry;
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
    // Keep only position/normal so geometries with differing attribute sets merge.
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

/** Center on the build plate: centered in XY, resting on z = 0 (Z-up). */
function centerOnPlate(g: THREE.BufferGeometry): void {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const minZ = bb.min.z;
  g.translate(-cx, -cy, -minZ);
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

async function loadGltf(file: File, ext: string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  const data: ArrayBuffer | string =
    ext === 'glb' ? await file.arrayBuffer() : await file.text();
  const gltf = await loader.parseAsync(data as ArrayBuffer, '');
  return mergeObject3D(gltf.scene);
}

async function loadStep(file: File): Promise<THREE.BufferGeometry> {
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

  const geometries: THREE.BufferGeometry[] = [];
  for (const mesh of result.meshes) {
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
    geometries.push(g.index ? g.toNonIndexed() : g);
  }
  const merged =
    geometries.length === 1
      ? geometries[0]
      : BufferGeometryUtils.mergeGeometries(geometries, false);
  if (!merged.getAttribute('normal')) merged.computeVertexNormals();
  return merged;
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported';

  let geometry: THREE.BufferGeometry;
  let format: ModelFormat;

  switch (ext) {
    case 'stl': {
      const buf = await file.arrayBuffer();
      geometry = new STLLoader().parse(buf);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      format = 'stl';
      break;
    }
    case 'obj': {
      const text = await file.text();
      geometry = mergeObject3D(new OBJLoader().parse(text));
      format = 'obj';
      break;
    }
    case 'gltf':
    case 'glb': {
      geometry = await loadGltf(file, ext);
      format = ext === 'glb' ? 'glb' : 'gltf';
      break;
    }
    case 'step':
    case 'stp': {
      geometry = await loadStep(file);
      format = 'step';
      break;
    }
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }

  centerOnPlate(geometry);
  return { name, format, geometry };
}

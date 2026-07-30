import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GeometryData, ModelFormat } from '../state/types';
import { geometryToData } from './geometryCache';
import type { WorkerPart, WorkerRequest, WorkerResponse } from './modelWorker';

/** A single parsed mesh part: metadata + raw typed-array geometry. */
export interface LoadedPart {
  name: string;
  /** Hex color from the source file, if any (e.g. STEP face/solid colors). */
  color?: string;
  data: GeometryData;
}

export interface LoadedModel {
  format: ModelFormat;
  parts: LoadedPart[];
}

export const SUPPORTED_EXTENSIONS = ['stl', 'obj', 'gltf', 'glb', 'step', 'stp'];

// ---- Web Worker (STEP / STL / OBJ parse off the main thread) ----

let worker: Worker | undefined;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./modelWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

let reqCounter = 0;
function runWorker(
  kind: string,
  name: string,
  buffer: ArrayBuffer,
  quality: number,
): Promise<{ format: string; parts: WorkerPart[] }> {
  return new Promise((resolve, reject) => {
    const reqId = ++reqCounter;
    const w = getWorker();
    const onMsg = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.reqId !== reqId) return;
      w.removeEventListener('message', onMsg);
      if (e.data.ok) resolve({ format: e.data.format, parts: e.data.parts });
      else reject(new Error(e.data.error));
    };
    w.addEventListener('message', onMsg);
    const req: WorkerRequest = { reqId, kind, name, buffer, quality };
    w.postMessage(req, [buffer]);
  });
}

function workerPartToLoaded(p: WorkerPart): LoadedPart {
  return { name: p.name, color: p.color, data: { positions: p.positions, normals: p.normals, index: p.index } };
}

// ---- GLTF / GLB (kept on the main thread; loader is browser-API heavy) ----

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
  if (geometries.length === 0) throw new Error('No mesh geometry found in file');
  return geometries.length === 1
    ? geometries[0]
    : BufferGeometryUtils.mergeGeometries(geometries, false);
}

async function loadGltf(file: File, ext: string): Promise<THREE.BufferGeometry> {
  const loader = new GLTFLoader();
  const data: ArrayBuffer | string =
    ext === 'glb' ? await file.arrayBuffer() : await file.text();
  const gltf = await loader.parseAsync(data as ArrayBuffer, '');
  return mergeObject3D(gltf.scene);
}

/** Center a single geometry: XY-centered, resting on z = 0. */
function centerGeometry(g: THREE.BufferGeometry): void {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
}

export async function loadModelFile(file: File, quality = 0.5): Promise<LoadedModel> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported';

  switch (ext) {
    case 'stl':
    case 'obj':
    case 'step':
    case 'stp': {
      const buffer = await file.arrayBuffer();
      const { format, parts } = await runWorker(ext, name, buffer, quality);
      return { format: format as ModelFormat, parts: parts.map(workerPartToLoaded) };
    }
    case 'gltf':
    case 'glb': {
      const geometry = await loadGltf(file, ext);
      centerGeometry(geometry);
      return {
        format: ext === 'glb' ? 'glb' : 'gltf',
        parts: [{ name, data: geometryToData(geometry) }],
      };
    }
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

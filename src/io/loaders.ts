import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import dracoWrapperUrl from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url';
import dracoWasmUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url';
import dracoJsUrl from 'three/examples/jsm/libs/draco/gltf/draco_decoder.js?url';
import type { GeometryData, ModelFormat } from '../state/types';
import { centerParts, extractParts } from './parts';
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
}

/**
 * Called for each streamed batch of parts as a model loads. `loaded`/`total`
 * count parts across the whole file so callers can show import progress.
 */
export type PartsHandler = (
  parts: LoadedPart[],
  loaded: number,
  total: number,
) => void;

export const SUPPORTED_EXTENSIONS = ['stl', 'obj', 'gltf', 'glb', 'fbx', 'step', 'stp'];

/** Files that aren't models themselves but may be referenced by one (a .gltf's
 * external buffers and textures). Selected alongside a model, they're used to
 * resolve its references rather than imported. */
export const COMPANION_EXTENSIONS = ['bin', 'png', 'jpg', 'jpeg', 'webp', 'ktx2'];

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
  onParts: PartsHandler,
): Promise<{ format: string }> {
  return new Promise((resolve, reject) => {
    const reqId = ++reqCounter;
    const w = getWorker();
    const onMsg = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.reqId !== reqId) return;
      if (!e.data.ok) {
        w.removeEventListener('message', onMsg);
        reject(new Error(e.data.error));
        return;
      }
      onParts(e.data.parts.map(workerPartToLoaded), e.data.loaded, e.data.total);
      if (e.data.done) {
        w.removeEventListener('message', onMsg);
        resolve({ format: e.data.format });
      }
    };
    w.addEventListener('message', onMsg);
    const req: WorkerRequest = { reqId, kind, name, buffer, quality };
    w.postMessage(req, [buffer]);
  });
}

function workerPartToLoaded(p: WorkerPart): LoadedPart {
  return { name: p.name, color: p.color, data: { positions: p.positions, normals: p.normals, index: p.index } };
}

// ---- glTF / GLB / FBX (kept on the main thread; loaders are browser-API heavy) ----

/**
 * A loading manager that resolves a file's external references (a .gltf's .bin
 * buffers and textures) against the other files the user selected. Anything not
 * supplied is recorded in `missing` and stubbed with an empty data URL instead
 * of being fetched from the app's own server.
 */
function makeManager(resources: Map<string, File>) {
  const manager = new THREE.LoadingManager();
  const objectUrls = new Map<string, string>();
  const missing = new Set<string>();
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    const base = decodeURIComponent(url.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '').toLowerCase();
    const file = resources.get(base);
    if (!file) {
      missing.add(base);
      return 'data:,';
    }
    let objectUrl = objectUrls.get(base);
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file);
      objectUrls.set(base, objectUrl);
    }
    return objectUrl;
  });
  const dispose = () => {
    for (const u of objectUrls.values()) URL.revokeObjectURL(u);
  };
  return { manager, missing, dispose };
}

/** Missing references that aren't images — i.e. geometry buffers we can't do without. */
function missingBuffers(missing: Set<string>): string[] {
  return [...missing].filter((n) => !/\.(png|jpe?g|webp|ktx2|gif|bmp|tga|tiff?)$/.test(n));
}

// Draco decoder files are bundled by Vite (hashed URLs), so DRACOLoader's
// `decoderPath + filename` requests are remapped to them by basename.
let dracoLoader: DRACOLoader | undefined;
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    const urls: Record<string, string> = {
      'draco_wasm_wrapper.js': dracoWrapperUrl,
      'draco_decoder.wasm': dracoWasmUrl,
      'draco_decoder.js': dracoJsUrl,
    };
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => urls[url.split('/').pop() ?? ''] ?? url);
    dracoLoader = new DRACOLoader(manager).setDecoderPath('draco/');
  }
  return dracoLoader;
}

async function loadGltf(
  file: File,
  ext: string,
  resources: Map<string, File>,
): Promise<THREE.Object3D> {
  const { manager, missing, dispose } = makeManager(resources);
  const loader = new GLTFLoader(manager)
    .setDRACOLoader(getDracoLoader())
    .setMeshoptDecoder(MeshoptDecoder);
  const data: ArrayBuffer | string =
    ext === 'glb' ? await file.arrayBuffer() : await file.text();
  // A stubbed buffer may make parsing throw or silently yield empty geometry;
  // either way, report the missing file rather than the symptom.
  const checkMissing = () => {
    const lacking = missingBuffers(missing);
    if (lacking.length) {
      throw new Error(`${file.name} references ${lacking.join(', ')} — select it together with the .gltf`);
    }
  };
  try {
    const gltf = await loader.parseAsync(data as ArrayBuffer, '');
    checkMissing();
    return gltf.scene;
  } catch (err) {
    checkMissing();
    throw err;
  } finally {
    dispose();
  }
}

async function loadFbx(file: File, resources: Map<string, File>): Promise<THREE.Object3D> {
  const { manager, dispose } = makeManager(resources);
  try {
    // Missing external textures only warn; we keep geometry + base color.
    return new FBXLoader(manager).parse(await file.arrayBuffer(), '');
  } finally {
    dispose();
  }
}

/** Parts per onParts call, matching the worker's streaming chunk size. */
const STREAM_CHUNK = 100;

/** Hands parts off in chunks, yielding between them so each batch can mount + paint. */
async function streamParts(parts: LoadedPart[], onParts: PartsHandler): Promise<void> {
  const total = parts.length;
  for (let i = 0; i < total; i += STREAM_CHUNK) {
    if (i > 0) await new Promise((r) => setTimeout(r));
    onParts(parts.slice(i, i + STREAM_CHUNK), Math.min(i + STREAM_CHUNK, total), total);
  }
}

/**
 * Loads a model file, delivering parts to `onParts` in batches as they become
 * available (a large STEP assembly streams many batches; single-mesh formats
 * deliver one). Resolves with the file format once every part has been handed off.
 */
export async function loadModelFile(
  file: File,
  quality = 0.5,
  onParts: PartsHandler,
  /** Companion files (lowercased name → File) for resolving external references. */
  resources: Map<string, File> = new Map(),
): Promise<LoadedModel> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '') || 'Imported';

  switch (ext) {
    case 'stl':
    case 'obj':
    case 'step':
    case 'stp': {
      const buffer = await file.arrayBuffer();
      const { format } = await runWorker(ext, name, buffer, quality, onParts);
      return { format: format as ModelFormat };
    }
    case 'gltf':
    case 'glb':
    case 'fbx': {
      const root = ext === 'fbx' ? await loadFbx(file, resources) : await loadGltf(file, ext, resources);
      const parts = extractParts(root, name);
      centerParts(parts.map((p) => p.data));
      await streamParts(parts, onParts);
      return { format: ext as ModelFormat };
    }
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

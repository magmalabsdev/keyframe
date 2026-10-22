import { describe, it, expect } from 'vitest';
import { loadModelFile, type LoadedPart } from './loaders';

// GLTFLoader's FileLoader dispatches ProgressEvents, which Node lacks.
(globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= class extends Event {
  lengthComputable: boolean;
  loaded: number;
  total: number;
  constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
    super(type);
    this.lengthComputable = !!init.lengthComputable;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
};

// One triangle, 3 units tall along +Y (glTF up), shared by two red/blue nodes.
const bin = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 3, 0]).buffer);

function gltfJson(bufferUri?: string) {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, name: 'A' }, { mesh: 1, name: 'B', translation: [5, 0, 0] }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
      { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] } },
    ],
    buffers: [{ byteLength: bin.byteLength, ...(bufferUri ? { uri: bufferUri } : {}) }],
    bufferViews: [{ buffer: 0, byteLength: bin.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 3, 0] }],
  };
}

/** Packs a glTF JSON + binary chunk into a GLB container. */
function toGlb(json: object, binChunk: Uint8Array): Uint8Array<ArrayBuffer> {
  const pad = (n: number) => (n + 3) & ~3;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad(jsonBytes.length);
  const binLen = pad(binChunk.length);
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonBytes, 20);
  view.setUint32(20 + jsonLen, binLen, true);
  view.setUint32(24 + jsonLen, 0x004e4942, true); // 'BIN\0'
  out.set(binChunk, 28 + jsonLen);
  return out;
}

async function load(file: File, resources = new Map<string, File>()) {
  const parts: LoadedPart[] = [];
  const out = await loadModelFile(file, 0.5, (p) => parts.push(...p), resources);
  return { format: out.format, parts };
}

function expectTwoColoredZUpParts(parts: LoadedPart[]) {
  expect(parts.map((p) => [p.name, p.color])).toEqual([['A', '#ff0000'], ['B', '#0000ff']]);
  const zs = [...parts[0].data.positions].filter((_, i) => i % 3 === 2);
  expect(Math.max(...zs)).toBeCloseTo(3);
  expect(Math.min(...zs)).toBeCloseTo(0);
}

describe('loadModelFile (glTF)', () => {
  it('loads a multi-mesh .gltf with an external .bin', async () => {
    const res = new Map([['tri.bin', new File([bin], 'tri.bin')]]);
    const { format, parts } = await load(new File([JSON.stringify(gltfJson('tri.bin'))], 'model.gltf'), res);
    expect(format).toBe('gltf');
    expectTwoColoredZUpParts(parts);
  });

  it('matches companion files case-insensitively', async () => {
    const res = new Map([['tri.bin', new File([bin], 'TRI.BIN')]]);
    const { parts } = await load(new File([JSON.stringify(gltfJson('TRI.bin'))], 'model.gltf'), res);
    expect(parts).toHaveLength(2);
  });

  it('names the missing .bin when it was not selected', async () => {
    await expect(load(new File([JSON.stringify(gltfJson('tri.bin'))], 'model.gltf'))).rejects.toThrow(
      /references tri\.bin/,
    );
  });

  it('loads a .glb with an embedded buffer', async () => {
    const { format, parts } = await load(new File([toGlb(gltfJson(), bin)], 'model.glb'));
    expect(format).toBe('glb');
    expectTwoColoredZUpParts(parts);
  });
});

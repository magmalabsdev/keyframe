import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type * as THREE from 'three';
import type { GeometryData, Project, Scene } from '../state/types';
import { buildGeometry } from './geometryCache';

/**
 * Self-contained keyframe document container (.kfp / .kfpx).
 *
 * Layout inside the zip:
 *   project.json       manifest: project metadata + scenes + asset metadata
 *   geom/<id>.bin      per-asset binary geometry (Float32 pos, Float32 norm, Uint32 index)
 *
 * Geometry is stored as packed typed arrays rather than JSON so files stay
 * compact even for dense CAD meshes.
 */

const CONTAINER_VERSION = 1;

interface AssetMeta {
  id: string;
  name: string;
  format: string;
  posCount: number;
  normCount: number;
  indexCount: number;
}

interface Manifest {
  container: number;
  version: number;
  name: string;
  scenes: Scene[];
  activeSceneId: string;
  assetMeta: Record<string, AssetMeta>;
}

function geometryToBin(geometry: GeometryData): Uint8Array {
  const pos = new Float32Array(geometry.positions);
  const norm = new Float32Array(geometry.normals ?? []);
  const idx = new Uint32Array(geometry.index ?? []);
  const out = new Uint8Array(pos.byteLength + norm.byteLength + idx.byteLength);
  out.set(new Uint8Array(pos.buffer), 0);
  out.set(new Uint8Array(norm.buffer), pos.byteLength);
  out.set(new Uint8Array(idx.buffer), pos.byteLength + norm.byteLength);
  return out;
}

function binToGeometry(bytes: Uint8Array, meta: AssetMeta): GeometryData {
  // Copy into a fresh, aligned ArrayBuffer before creating typed-array views.
  const buf = bytes.slice().buffer;
  let offset = 0;
  const positions = Array.from(new Float32Array(buf, offset, meta.posCount));
  offset += meta.posCount * 4;
  const normals = meta.normCount
    ? Array.from(new Float32Array(buf, offset, meta.normCount))
    : undefined;
  offset += meta.normCount * 4;
  const index = meta.indexCount
    ? Array.from(new Uint32Array(buf, offset, meta.indexCount))
    : undefined;
  return { positions, normals, index };
}

/** Serialize selected scenes (and their assets) into a zip container. */
export function serializeProject(project: Project, sceneIds: string[]): Uint8Array {
  const scenes = project.scenes.filter((s) => sceneIds.includes(s.id));
  const usedAssetIds = new Set<string>();
  for (const scene of scenes) {
    for (const obj of scene.objects) {
      if (obj.assetId) usedAssetIds.add(obj.assetId);
    }
  }

  const files: Record<string, Uint8Array> = {};
  const assetMeta: Record<string, AssetMeta> = {};
  for (const id of usedAssetIds) {
    const asset = project.assets[id];
    if (!asset) continue;
    files[`geom/${id}.bin`] = geometryToBin(asset.geometry);
    assetMeta[id] = {
      id,
      name: asset.name,
      format: asset.format,
      posCount: asset.geometry.positions.length,
      normCount: asset.geometry.normals?.length ?? 0,
      indexCount: asset.geometry.index?.length ?? 0,
    };
  }

  const manifest: Manifest = {
    container: CONTAINER_VERSION,
    version: project.version,
    name: project.name,
    scenes,
    activeSceneId:
      scenes.find((s) => s.id === project.activeSceneId)?.id ?? scenes[0]?.id,
    assetMeta,
  };
  files['project.json'] = strToU8(JSON.stringify(manifest));

  return zipSync(files, { level: 6 });
}

export interface ParsedContainer {
  project: Project;
  geometries: Map<string, THREE.BufferGeometry>;
}

/** Parse a .kfp/.kfpx container back into a project + built geometries. */
export function parseProjectContainer(bytes: Uint8Array): ParsedContainer {
  const files = unzipSync(bytes);
  const manifestFile = files['project.json'];
  if (!manifestFile) throw new Error('Invalid keyframe file: missing project.json');
  const manifest = JSON.parse(strFromU8(manifestFile)) as Manifest;

  const assets: Project['assets'] = {};
  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const meta of Object.values(manifest.assetMeta)) {
    const bin = files[`geom/${meta.id}.bin`];
    if (!bin) continue;
    const geometry = binToGeometry(bin, meta);
    assets[meta.id] = {
      id: meta.id,
      name: meta.name,
      format: meta.format as Project['assets'][string]['format'],
      geometry,
    };
    geometries.set(meta.id, buildGeometry(geometry));
  }

  const project: Project = {
    version: manifest.version,
    name: manifest.name,
    scenes: manifest.scenes,
    activeSceneId: manifest.activeSceneId,
    assets,
  };
  return { project, geometries };
}

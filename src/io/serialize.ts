import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type * as THREE from 'three';
import type { GeometryData, MediaAsset, Project, Scene, Variable } from '../state/types';
import { buildGeometry, getGeometryData, putGeometry, putGeometryData } from './geometryCache';
import { getMediaBlob, putMedia } from './mediaCache';
import { decodeAudio } from './audioCache';
import { migrateProject } from '../state/migrate';

/**
 * Self-contained keyframe document container (.kfp / .kfpx).
 *
 * Layout inside the zip:
 *   project.json       manifest: project metadata + scenes + asset/media metadata
 *   geom/<id>.bin      per-asset binary geometry (Float32 pos, Float32 norm, Uint32 index)
 *   media/<id>.<ext>   raw bytes of uploaded images/gifs/videos
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
  mediaMeta: Record<string, MediaAsset>;
  variables?: Variable[];
  bindings?: Record<string, string>;
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/webm': 'weba',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'font/woff': 'woff',
  'application/font-sfnt': 'ttf',
  'application/x-font-ttf': 'ttf',
};

function extForMime(mimeType: string): string {
  return MIME_EXT[mimeType] ?? mimeType.split('/')[1] ?? 'bin';
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
  const positions = new Float32Array(buf, offset, meta.posCount);
  offset += meta.posCount * 4;
  const normals = meta.normCount
    ? new Float32Array(buf, offset, meta.normCount)
    : undefined;
  offset += meta.normCount * 4;
  const index = meta.indexCount
    ? new Uint32Array(buf, offset, meta.indexCount)
    : undefined;
  return { positions, normals, index };
}

/** Serialize selected scenes (and their assets/media) into a zip container. */
export async function serializeProject(project: Project, sceneIds: string[]): Promise<Uint8Array> {
  const scenes = project.scenes.filter((s) => sceneIds.includes(s.id));
  const usedAssetIds = new Set<string>();
  const usedMediaIds = new Set<string>();
  for (const scene of scenes) {
    for (const obj of scene.objects) {
      if (obj.assetId) usedAssetIds.add(obj.assetId);
      if (obj.material.textureAssetId) usedMediaIds.add(obj.material.textureAssetId);
      if (obj.surface?.mediaId) usedMediaIds.add(obj.surface.mediaId);
      if (obj.surface?.fontId) usedMediaIds.add(obj.surface.fontId);
      if (obj.text?.fontId) usedMediaIds.add(obj.text.fontId);
    }
    if (scene.settings.backgroundMediaId) usedMediaIds.add(scene.settings.backgroundMediaId);
    for (const track of scene.audioTracks ?? []) {
      for (const clip of track.clips) usedMediaIds.add(clip.mediaId);
    }
  }

  const files: Record<string, Uint8Array> = {};
  const assetMeta: Record<string, AssetMeta> = {};
  for (const id of usedAssetIds) {
    const asset = project.assets[id];
    const data = getGeometryData(id);
    if (!asset || !data) continue;
    files[`geom/${id}.bin`] = geometryToBin(data);
    assetMeta[id] = {
      id,
      name: asset.name,
      format: asset.format,
      posCount: data.positions.length,
      normCount: data.normals?.length ?? 0,
      indexCount: data.index?.length ?? 0,
    };
  }

  const mediaMeta: Record<string, MediaAsset> = {};
  for (const id of usedMediaIds) {
    const media = project.media[id];
    const blob = getMediaBlob(id);
    if (!media || !blob) continue;
    files[`media/${id}.${extForMime(media.mimeType)}`] = new Uint8Array(await blob.arrayBuffer());
    mediaMeta[id] = media;
  }

  const manifest: Manifest = {
    container: CONTAINER_VERSION,
    version: project.version,
    name: project.name,
    scenes,
    activeSceneId:
      scenes.find((s) => s.id === project.activeSceneId)?.id ?? scenes[0]?.id,
    assetMeta,
    mediaMeta,
    variables: project.variables ?? [],
    bindings: project.bindings ?? {},
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
    const data = binToGeometry(bin, meta);
    // Asset metadata only in the project; geometry lives in the caches.
    assets[meta.id] = {
      id: meta.id,
      name: meta.name,
      format: meta.format as Project['assets'][string]['format'],
    };
    putGeometryData(meta.id, data);
    const geometry = buildGeometry(data);
    putGeometry(meta.id, geometry);
    geometries.set(meta.id, geometry);
  }

  const media: Project['media'] = {};
  for (const meta of Object.values(manifest.mediaMeta ?? {})) {
    const bytes = files[`media/${meta.id}.${extForMime(meta.mimeType)}`];
    if (!bytes) continue;
    const blob = new Blob([bytes], { type: meta.mimeType });
    putMedia(meta.id, blob);
    // Decode audio into the audio cache so it can play/export after import.
    if (meta.kind === 'audio') void decodeAudio(meta.id, blob).catch(() => {});
    media[meta.id] = meta;
  }

  const project: Project = migrateProject({
    version: manifest.version,
    name: manifest.name,
    scenes: manifest.scenes,
    activeSceneId: manifest.activeSceneId,
    assets,
    media,
    variables: manifest.variables ?? [],
    bindings: manifest.bindings ?? {},
  });
  return { project, geometries };
}

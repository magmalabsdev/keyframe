import * as THREE from 'three';
import type { MediaAsset, TextureMode } from '../state/types';
import { getMediaUrl } from '../io/mediaCache';
import { useEditorStore } from '../state/editorStore';

/** Cached object-texture (image wrapped onto a mesh via box-projected UVs, 'fill' mode). */
const objectTextures = new Map<string, THREE.Texture>();
/** Cached 'tile' clones of object textures, keyed by `${mediaId}:${scale}`. */
const tileTextures = new Map<string, THREE.Texture>();

/** Sets `tile.repeat` so the image tiles at `scale` mm, preserving its native aspect ratio. */
function applyTileRepeat(tile: THREE.Texture, base: THREE.Texture, scale: number): void {
  const img = base.image as { width?: number; height?: number } | undefined;
  if (!img?.width || !img?.height) return;
  const aspect = img.width / img.height;
  tile.repeat.set(1 / scale, aspect / scale);
  tile.needsUpdate = true;
}

function loadBaseTexture(media: MediaAsset): THREE.Texture | undefined {
  const cached = objectTextures.get(media.id);
  if (cached) return cached;
  const url = getMediaUrl(media.id);
  if (!url) return undefined;

  const taskId = `texture-${media.id}`;
  useEditorStore.getState().startBackgroundTask(taskId, `Loading texture: ${media.name}`);

  const texture = new THREE.TextureLoader().load(
    url,
    () => {
      texture.needsUpdate = true;
      for (const [key, tile] of tileTextures) {
        if (key.startsWith(`${media.id}:`)) {
          applyTileRepeat(tile, texture, Number(key.slice(media.id.length + 1)));
        }
      }
      useEditorStore.getState().endBackgroundTask(taskId);
    },
    undefined,
    () => useEditorStore.getState().endBackgroundTask(taskId),
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  objectTextures.set(media.id, texture);
  return texture;
}

/**
 * Returns the texture for an object material, ready to assign to `map`.
 * - 'fill' (default): the raw image sampled via the box-projected `uv` set
 *   (0..1 per face), stretching it to cover each face.
 * - 'tile': a clone sampled via the `uv1` set (raw mm offsets, see
 *   `ensureTileUVs`), repeated at `scale` mm preserving the image's aspect ratio.
 */
export function getObjectTexture(
  media: MediaAsset,
  mode: TextureMode = 'fill',
  scale = 100,
): THREE.Texture | undefined {
  const base = loadBaseTexture(media);
  if (!base || mode === 'fill') return base;

  const key = `${media.id}:${scale}`;
  let tile = tileTextures.get(key);
  if (!tile) {
    tile = base.clone();
    tile.wrapS = THREE.RepeatWrapping;
    tile.wrapT = THREE.RepeatWrapping;
    tile.channel = 1;
    tileTextures.set(key, tile);
    applyTileRepeat(tile, base, scale);
  }
  return tile;
}

/** Cached background image textures (static images, including the first GIF frame). */
const backgroundImageTextures = new Map<string, THREE.Texture>();
/** Hidden <img> elements backing animated-GIF background textures, kept refreshed each frame. */
const gifElements = new Map<string, HTMLImageElement>();
/** Hidden <video> elements backing video background textures (also used for export seeking). */
const videoElements = new Map<string, HTMLVideoElement>();
const videoTextures = new Map<string, THREE.VideoTexture>();

function getGifTexture(media: MediaAsset): THREE.Texture {
  let img = gifElements.get(media.id);
  if (!img) {
    img = document.createElement('img');
    img.src = getMediaUrl(media.id)!;
    img.style.position = 'absolute';
    img.style.width = '1px';
    img.style.height = '1px';
    img.style.opacity = '0';
    img.style.pointerEvents = 'none';
    document.body.appendChild(img);
    gifElements.set(media.id, img);
  }
  let texture = backgroundImageTextures.get(media.id);
  if (!texture) {
    texture = new THREE.Texture(img);
    texture.colorSpace = THREE.SRGBColorSpace;
    backgroundImageTextures.set(media.id, texture);
  }
  return texture;
}

/** Refreshes any animated-GIF background textures so they show the current frame. */
export function updateAnimatedBackgroundTextures(): void {
  for (const texture of backgroundImageTextures.values()) {
    texture.needsUpdate = true;
  }
}

export function getBackgroundVideoElement(media: MediaAsset): HTMLVideoElement {
  let video = videoElements.get(media.id);
  if (!video) {
    video = document.createElement('video');
    video.src = getMediaUrl(media.id)!;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.style.position = 'absolute';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);
    videoElements.set(media.id, video);
  }
  return video;
}

/** Returns the background texture for a media asset, creating it on first use. */
export function getBackgroundTexture(media: MediaAsset): THREE.Texture | undefined {
  if (!getMediaUrl(media.id)) return undefined;

  if (media.kind === 'video') {
    let texture = videoTextures.get(media.id);
    if (!texture) {
      const video = getBackgroundVideoElement(media);
      void video.play().catch(() => {});
      texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      videoTextures.set(media.id, texture);
    }
    return texture;
  }

  if (media.mimeType === 'image/gif') {
    return getGifTexture(media);
  }

  let texture = backgroundImageTextures.get(media.id);
  if (!texture) {
    const taskId = `texture-${media.id}`;
    useEditorStore.getState().startBackgroundTask(taskId, `Loading background: ${media.name}`);
    texture = new THREE.TextureLoader().load(
      getMediaUrl(media.id)!,
      () => useEditorStore.getState().endBackgroundTask(taskId),
      undefined,
      () => useEditorStore.getState().endBackgroundTask(taskId),
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    backgroundImageTextures.set(media.id, texture);
  }
  return texture;
}

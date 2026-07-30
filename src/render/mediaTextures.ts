import * as THREE from 'three';
import type { MediaAsset, SurfaceFit, TextureMode } from '../state/types';
import { getMediaUrl } from '../io/mediaCache';
import { useEditorStore } from '../state/editorStore';

/** Cached object-texture (image wrapped onto a mesh via box-projected UVs, 'fill' mode). */
const objectTextures = new Map<string, THREE.Texture>();
/** Cached 'tile' clones of object textures, keyed by `${mediaId}:${scale}`. */
const tileTextures = new Map<string, THREE.Texture>();
/** Cached aspect-corrected surface clones, keyed by `${mediaId}:${fit}:${boxAspect}`. */
const surfaceTextures = new Map<string, THREE.Texture>();

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
      const aspect = imageAspectOf(texture);
      if (aspect) refitSurfaceTextures(media.id, aspect);
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

/** Refreshes any animated-GIF textures (background or surface) to the current frame. */
export function updateAnimatedTextures(): void {
  for (const texture of backgroundImageTextures.values()) {
    texture.needsUpdate = true;
  }
}

/** @deprecated Use `updateAnimatedTextures` — GIFs are no longer background-only. */
export const updateAnimatedBackgroundTextures = updateAnimatedTextures;

/**
 * The hidden <video> backing a media asset, created on first use. One element
 * per asset, shared by the scene background and every surface using it (so
 * they stay frame-locked, and the exporter has a single thing to seek).
 */
export function getVideoElement(media: MediaAsset): HTMLVideoElement {
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

/** @deprecated Use `getVideoElement` — videos are no longer background-only. */
export const getBackgroundVideoElement = getVideoElement;

/** The shared <video> for a media asset, if one has been created. */
export function getExistingVideoElement(mediaId: string): HTMLVideoElement | undefined {
  return videoElements.get(mediaId);
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

/**
 * Sets repeat/offset so the image fills `boxAspect` without distortion, centered.
 * 'cover' samples a sub-region (repeat < 1, cropping the overflow); 'contain'
 * samples beyond the image (repeat > 1), where ClampToEdge smears the edge
 * pixel into the letterbox bars.
 */
function applyFit(
  texture: THREE.Texture,
  imageAspect: number,
  boxAspect: number,
  fit: SurfaceFit,
): void {
  const ratio = imageAspect / boxAspect;
  if (fit === 'cover') {
    if (ratio > 1) texture.repeat.set(1 / ratio, 1); // image wider: crop sides
    else texture.repeat.set(1, ratio); // image taller: crop top/bottom
  } else {
    if (ratio > 1) texture.repeat.set(1, ratio); // image wider: bars top/bottom
    else texture.repeat.set(1 / ratio, 1); // image taller: bars at the sides
  }
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
  texture.needsUpdate = true;
}

/** Natural aspect of a loaded texture's image, or undefined if not yet known. */
function imageAspectOf(texture: THREE.Texture): number | undefined {
  const img = texture.image as { width?: number; height?: number } | undefined;
  return img?.width && img?.height ? img.width / img.height : undefined;
}

/** Re-applies fit to every surface clone of a media asset once its size is known. */
function refitSurfaceTextures(mediaId: string, imageAspect: number): void {
  for (const [key, texture] of surfaceTextures) {
    if (!key.startsWith(`${mediaId}:`)) continue;
    const [, fit, boxAspect] = key.split(':');
    applyFit(texture, imageAspect, Number(boxAspect), fit as SurfaceFit);
  }
}

/**
 * The texture for a surface's polygon, ready to assign to `map`. Surface UVs
 * already span the polygon bounds 0..1, so 'stretch' needs no correction and
 * returns the shared base texture; 'contain'/'cover' get an aspect-corrected
 * clone. Image and video dimensions arrive asynchronously, so the correction
 * is re-applied once they are known.
 */
export function getSurfaceTexture(
  media: MediaAsset,
  fit: SurfaceFit = 'stretch',
  boxAspect = 1,
): THREE.Texture | undefined {
  const base =
    media.kind === 'video' || media.mimeType === 'image/gif'
      ? getBackgroundTexture(media)
      : loadBaseTexture(media);
  if (!base || fit === 'stretch') return base;

  const key = `${media.id}:${fit}:${boxAspect.toFixed(3)}`;
  let texture = surfaceTextures.get(key);
  if (!texture) {
    texture = base.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    surfaceTextures.set(key, texture);

    if (media.kind === 'video') {
      const video = getVideoElement(media);
      const sync = () =>
        applyFit(texture!, video.videoWidth / video.videoHeight, boxAspect, fit);
      if (video.videoWidth) sync();
      else video.addEventListener('loadedmetadata', sync, { once: true });
    } else {
      // Images may still be decoding; loadBaseTexture's onLoad calls
      // refitSurfaceTextures for anything that wasn't ready here.
      const aspect = imageAspectOf(base);
      if (aspect) applyFit(texture, aspect, boxAspect, fit);
    }
  }
  return texture;
}

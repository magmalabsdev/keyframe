import * as THREE from 'three';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { DEFAULT_FPS } from '../state/defaults';
import { applySceneAtTime } from './applyScene';
import { getVideoElement } from './mediaTextures';
import { getR3F } from './renderApi';
import {
  EXPORT_SAMPLE_RATE,
  encodeAudioIntoMuxer,
  isAudioExportSupported,
  mixSceneAudio,
} from './audioExport';

/** Seeks a video element to `timeSec` and waits for the frame to update. */
function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = timeSec;
  });
}

export interface ExportOptions {
  fps?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  onProgress?: (progress: number) => void;
}

const CODECS: { codec: string; muxer: 'avc' | 'vp9' }[] = [
  { codec: 'avc1.42001f', muxer: 'avc' }, // H.264 baseline L3.1 (720p)
  { codec: 'avc1.4d0028', muxer: 'avc' }, // H.264 main L4.0
  { codec: 'vp09.00.10.08', muxer: 'vp9' }, // VP9 fallback
];

export function isVideoExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  );
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_') || 'render';
}

function downloadMp4(filename: string, buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Renders the active scene frame-by-frame (deterministically, not in real time)
 * and encodes an mp4 via WebCodecs. Temporarily switches the renderer to the
 * export resolution and stops the live loop, restoring both afterward.
 */
export async function exportVideo(opts: ExportOptions = {}): Promise<void> {
  const { width = 1280, height = 720, bitrate = 8_000_000, onProgress } = opts;

  if (!isVideoExportSupported()) {
    throw new Error('WebCodecs video export is not supported in this browser.');
  }
  const root = getR3F();
  if (!root) throw new Error('Renderer is not ready yet.');

  const gl = root.gl as THREE.WebGLRenderer;
  const threeScene = root.scene as THREE.Scene;
  const camera = root.camera as THREE.PerspectiveCamera;
  const setFrameloop = root.setFrameloop;

  const project = useDocumentStore.getState().project;
  const sceneData = getActiveScene(project);
  // The scene's own frame rate is the export rate, so what you step through in
  // the timeline is what gets encoded. An explicit option still wins.
  const fps = opts.fps ?? sceneData.settings.fps ?? DEFAULT_FPS;
  const frameCount = Math.max(1, Math.round((sceneData.durationMs / 1000) * fps));

  // Every video in the scene — background and surfaces alike — must be driven
  // off the playhead. Left playing, they'd advance on wall-clock time while the
  // export loop runs slower than realtime, desyncing the output. Surfaces
  // sharing a media id share one element, so dedupe by id.
  const videoIds = new Set<string>();
  if (sceneData.settings.backgroundMediaId) videoIds.add(sceneData.settings.backgroundMediaId);
  for (const obj of sceneData.objects) {
    if (obj.surface?.mediaId) videoIds.add(obj.surface.mediaId);
  }
  const videos: HTMLVideoElement[] = [];
  for (const mediaId of videoIds) {
    if (project.media[mediaId]?.kind !== 'video') continue;
    const video = getVideoElement(project.media[mediaId]);
    video.pause();
    videos.push(video);
  }

  let chosen: (typeof CODECS)[number] | null = null;
  for (const c of CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (support.supported) {
        chosen = c;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!chosen) throw new Error('No supported video codec found for export.');

  // Mix the timeline's audio offline (deterministic; can't be captured live
  // because export runs slower than realtime). If the browser can't encode
  // audio, we fall back to a silent video rather than failing the export.
  let mixedAudio: AudioBuffer | null = null;
  if (isAudioExportSupported()) {
    try {
      mixedAudio = await mixSceneAudio(sceneData);
      if (mixedAudio) {
        const support = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate: EXPORT_SAMPLE_RATE,
          numberOfChannels: 2,
          bitrate: 192_000,
        });
        if (!support.supported) mixedAudio = null;
      }
    } catch (e) {
      console.warn('Audio export unavailable; exporting silent video.', e);
      mixedAudio = null;
    }
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: chosen.muxer, width, height },
    ...(mixedAudio
      ? { audio: { codec: 'aac' as const, sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: 2 } }
      : {}),
    fastStart: 'in-memory',
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e;
    },
  });
  encoder.configure({ codec: chosen.codec, width, height, bitrate, framerate: fps });

  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevPixelRatio = gl.getPixelRatio();
  const prevAspect = camera.aspect;

  // Hide non-model helpers (build plate, grid, axes) so they aren't captured.
  const hidden: THREE.Object3D[] = [];
  threeScene.traverse((o) => {
    if (o.userData?.excludeFromRender && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  // Let React unmount the gizmo (it hides itself while exportProgress is set).
  await new Promise((r) => setTimeout(r, 60));

  // troika lays glyphs out in a worker and only kicks that off during a render,
  // so the first frames would export blank. Force a sync and wait for it.
  const texts: { sync: (cb: () => void) => void }[] = [];
  threeScene.traverse((o) => {
    if (o.userData?.troikaText) texts.push(o as unknown as { sync: (cb: () => void) => void });
  });
  await Promise.all(
    texts.map((t) => new Promise<void>((resolve) => t.sync(() => resolve()))),
  );

  setFrameloop?.('never');
  gl.setPixelRatio(1);
  gl.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  try {
    for (let i = 0; i < frameCount; i++) {
      if (encodeError) throw encodeError;
      const timeMs = (i / fps) * 1000;
      await Promise.all(
        videos
          .filter((v) => v.duration > 0)
          .map((v) => seekVideo(v, (timeMs / 1000) % v.duration)),
      );
      applySceneAtTime(sceneData, timeMs, threeScene, camera, project);
      gl.render(threeScene, camera);

      const frame = new VideoFrame(gl.domElement, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      while (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
      }
      onProgress?.((i + 1) / frameCount);
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
    if (mixedAudio) await encodeAudioIntoMuxer(muxer, mixedAudio);
    muxer.finalize();
    downloadMp4(`${safeName(sceneData.name)}.mp4`, muxer.target.buffer);
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    gl.setPixelRatio(prevPixelRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    for (const o of hidden) o.visible = true;
    setFrameloop?.('always');
    for (const v of videos) void v.play().catch(() => {});
  }
}

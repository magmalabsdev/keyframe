/**
 * Offline audio mixing + encoding for video export. Video export runs slower
 * than wall-clock, so audio can't be captured live — instead we render the whole
 * timeline's audio deterministically through an OfflineAudioContext, then encode
 * the mix with WebCodecs AudioEncoder (AAC) and feed it into the mp4 muxer.
 */
import type { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Scene } from '../state/types';
import { getMediaBlob } from '../io/mediaCache';
import { decodeAudio, getAudioBuffer } from '../io/audioCache';

export const EXPORT_SAMPLE_RATE = 48000;
const EXPORT_CHANNELS = 2;

export function isAudioExportSupported(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

/** True if the scene has at least one clip on a non-muted track. */
export function sceneHasAudio(scene: Scene): boolean {
  return (scene.audioTracks ?? []).some((t) => !t.muted && t.clips.length > 0);
}

/**
 * Renders every audio clip in the scene into a single stereo AudioBuffer that
 * spans the scene duration. Returns null if there is nothing to mix.
 */
export async function mixSceneAudio(scene: Scene): Promise<AudioBuffer | null> {
  if (!sceneHasAudio(scene)) return null;

  const length = Math.max(1, Math.ceil((scene.durationMs / 1000) * EXPORT_SAMPLE_RATE));
  const offline = new OfflineAudioContext(EXPORT_CHANNELS, length, EXPORT_SAMPLE_RATE);

  for (const track of scene.audioTracks ?? []) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      let buffer = getAudioBuffer(clip.mediaId);
      if (!buffer) {
        const blob = getMediaBlob(clip.mediaId);
        if (!blob) continue;
        try {
          buffer = await decodeAudio(clip.mediaId, blob);
        } catch {
          continue;
        }
      }
      const src = offline.createBufferSource();
      src.buffer = buffer;
      src.loop = clip.loop;
      if (clip.loop) {
        src.loopStart = clip.offsetMs / 1000;
        src.loopEnd = buffer.duration;
      }
      const gain = offline.createGain();
      gain.gain.value = track.gain * clip.gain;
      src.connect(gain).connect(offline.destination);

      const when = Math.max(0, clip.startMs / 1000);
      src.start(when, clip.offsetMs / 1000);
      src.stop(when + clip.durationMs / 1000);
    }
  }

  return offline.startRendering();
}

/**
 * Encodes a mixed AudioBuffer as AAC and adds the chunks to the muxer. The
 * muxer must have been created with a matching `audio` config.
 */
export async function encodeAudioIntoMuxer(
  muxer: Muxer<ArrayBufferTarget>,
  mixed: AudioBuffer,
): Promise<void> {
  const sampleRate = EXPORT_SAMPLE_RATE;
  const numberOfChannels = EXPORT_CHANNELS;

  let audioError: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      audioError = e;
    },
  });
  encoder.configure({
    codec: 'mp4a.40.2', // AAC-LC
    sampleRate,
    numberOfChannels,
    bitrate: 192_000,
  });

  const ch0 = mixed.getChannelData(0);
  const ch1 = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : ch0;
  const total = mixed.length;
  const frameSize = Math.floor(sampleRate / 10); // ~100 ms per AudioData chunk

  for (let start = 0; start < total; start += frameSize) {
    if (audioError) throw audioError;
    const n = Math.min(frameSize, total - start);
    // Planar layout: all of channel 0, then all of channel 1.
    const planar = new Float32Array(n * numberOfChannels);
    planar.set(ch0.subarray(start, start + n), 0);
    planar.set(ch1.subarray(start, start + n), n);
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels,
      timestamp: Math.round((start / sampleRate) * 1_000_000),
      data: planar,
    });
    encoder.encode(audioData);
    audioData.close();
    while (encoder.encodeQueueSize > 8) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  if (audioError) throw audioError;
  encoder.close();
}

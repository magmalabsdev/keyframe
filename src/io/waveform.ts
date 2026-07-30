/**
 * Audio waveform peaks for the timeline's clip bars. Two layers: a pure,
 * node-testable peak-computation core operating on raw Float32Arrays, and a
 * thin browser-facing cache wrapper keyed by mediaId (mirrors audioCache.ts's
 * own cache-by-mediaId pattern).
 */
import { getAudioBuffer } from './audioCache';

export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  sourceDurationMs: number;
}

/** Buckets computed once per mediaId, covering the FULL source duration (not
 * the current on-screen pixel width) — decouples the expensive O(samples)
 * scan from cheap per-render slicing during drag/zoom. */
export const PEAKS_RESOLUTION = 2000;

/**
 * Computes per-bucket min/max across ALL channels (not a channel-averaged
 * mixdown). Averaging channels before peak-detection can cancel out
 * out-of-phase stereo content and understate transients; taking the min/max
 * union across channels never underestimates a transient and costs the same
 * single O(samples) pass — the standard NLE approach.
 */
export function computePeaks(
  channels: Float32Array[],
  buckets: number,
): { mins: Float32Array; maxs: Float32Array } {
  const length = channels[0]?.length ?? 0;
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  if (length === 0 || buckets === 0) return { mins, maxs };
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b / buckets) * length);
    const end = Math.max(start + 1, Math.floor(((b + 1) / buckets) * length));
    let mn = Infinity;
    let mx = -Infinity;
    for (const ch of channels) {
      for (let i = start; i < end && i < ch.length; i++) {
        const v = ch[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    mins[b] = mn === Infinity ? 0 : mn;
    maxs[b] = mx === -Infinity ? 0 : mx;
  }
  return { mins, maxs };
}

/**
 * Downsamples/slices a full-resolution peaks array to `width` output columns
 * covering bucket range [startBucket, endBucket) (fractional bounds allowed —
 * used to map a clip's offsetMs/durationMs trim window, which rarely aligns
 * exactly to bucket boundaries, onto the current on-screen pixel width). Also
 * a min/max reduction, so it's correct whether width is larger (zoomed in) or
 * smaller (zoomed out) than the number of source buckets.
 */
export function resamplePeaks(
  mins: Float32Array,
  maxs: Float32Array,
  startBucket: number,
  endBucket: number,
  width: number,
): { mins: Float32Array; maxs: Float32Array } {
  const outMin = new Float32Array(width);
  const outMax = new Float32Array(width);
  const span = Math.max(endBucket - startBucket, 1e-6);
  for (let x = 0; x < width; x++) {
    const a = Math.max(0, Math.floor(startBucket + (x / width) * span));
    const b = Math.min(
      mins.length,
      Math.max(a + 1, Math.ceil(startBucket + ((x + 1) / width) * span)),
    );
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = a; i < b; i++) {
      if (mins[i] < mn) mn = mins[i];
      if (maxs[i] > mx) mx = maxs[i];
    }
    outMin[x] = mn === Infinity ? 0 : mn;
    outMax[x] = mx === -Infinity ? 0 : mx;
  }
  return { mins: outMin, maxs: outMax };
}

const peaksCache = new Map<string, WaveformPeaks>();

/**
 * Full-resolution peaks for a decoded clip source, computed once and cached.
 * Returns undefined if the source hasn't been decoded yet — callers should
 * re-render once `subscribeAudioDecoded` (audioCache.ts) fires.
 */
export function getWaveformPeaks(mediaId: string): WaveformPeaks | undefined {
  const cached = peaksCache.get(mediaId);
  if (cached) return cached;
  const buffer = getAudioBuffer(mediaId);
  if (!buffer) return undefined;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  const { mins, maxs } = computePeaks(channels, PEAKS_RESOLUTION);
  const peaks: WaveformPeaks = { mins, maxs, sourceDurationMs: buffer.duration * 1000 };
  peaksCache.set(mediaId, peaks);
  return peaks;
}

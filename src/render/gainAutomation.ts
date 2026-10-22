/**
 * Pure gain evaluation/sampling for keyframed audio clip volume. Kept free of
 * AudioContext/store globals so it is directly testable; the audio engine and
 * export both call this for a single source of truth on what a clip's gain is
 * at any timeline moment.
 */
import { evaluateTrack } from '../animation/evaluate';
import type { AudioClip } from '../state/types';

/** Whether a clip's gain is animated at all (vs. constant at `clip.gain`). */
export function hasGainKeyframes(clip: AudioClip): boolean {
  return (clip.gainTrack?.length ?? 0) > 0;
}

/** Instantaneous gain at a timeline time — 0 if the track is muted, otherwise
 * the keyframed curve (or the constant `clip.gain` where there's no track). */
export function gainAt(clip: AudioClip, muted: boolean, timeMs: number): number {
  if (muted) return 0;
  return evaluateTrack(clip.gainTrack, timeMs, clip.gain);
}

export interface GainCurveOptions {
  /** Upper bound on samples, so a very long clip doesn't build a huge array. */
  maxSamples?: number;
  /** Floor on the spacing between samples. */
  minStepMs?: number;
}

/**
 * Samples a clip's gain into a curve suitable for `AudioParam.setValueCurveAtTime`,
 * evenly spaced from timeline position `fromMs` to `toMs` (allowed to be
 * decreasing — reverse playback samples backward through the timeline while
 * real time still runs forward). Only worth calling when `hasGainKeyframes`;
 * a non-animated clip should just use a constant `gainAt(...)` value.
 */
export function sampleGainCurve(
  clip: AudioClip,
  muted: boolean,
  fromMs: number,
  toMs: number,
  opts: GainCurveOptions = {},
): Float32Array {
  const maxSamples = opts.maxSamples ?? 1000;
  const minStepMs = opts.minStepMs ?? 20;
  const span = Math.abs(toMs - fromMs);
  const stepMs = Math.max(minStepMs, span / maxSamples);
  const n = Math.max(2, Math.ceil(span / stepMs) + 1);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    curve[i] = gainAt(clip, muted, fromMs + (toMs - fromMs) * frac);
  }
  return curve;
}

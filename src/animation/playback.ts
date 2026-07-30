/**
 * Pure playhead advance for one frame of playback.
 *
 * Kept out of the render loop so the boundary rules — looping, in/out range,
 * one-shot stop points, reverse — are directly testable. The renderer just
 * feeds it the elapsed delta and applies the result.
 */

export interface AdvanceInput {
  timeMs: number;
  /** Signed rate: negative reverses, 1 is realtime. Never 0 (caller checks). */
  rate: number;
  deltaMs: number;
  durationMs: number;
  loop: boolean;
  inMs: number | null;
  outMs: number | null;
  /** One-shot stop point; wins over looping. */
  stopAtMs: number | null;
}

export interface AdvanceResult {
  timeMs: number;
  /** True when playback should stop at this time. */
  stop: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function advancePlayhead(i: AdvanceInput): AdvanceResult {
  const { timeMs, rate, deltaMs, durationMs, loop, stopAtMs } = i;

  // The play range, falling back to the whole scene when unset or inverted.
  let lo = i.inMs ?? 0;
  let hi = i.outMs ?? durationMs;
  if (lo >= hi) {
    lo = 0;
    hi = durationMs;
  }
  // A playhead parked outside the range shouldn't teleport into it — play on to
  // the real end instead, so scrubbing past the out point and hitting play does
  // something sane rather than jumping backwards.
  if (timeMs > hi) hi = durationMs;
  if (timeMs < lo) lo = 0;

  const t = timeMs + deltaMs * rate;

  // A one-shot stop point beats looping: that's what makes "play around" and
  // "play in to out" run exactly once even with loop enabled.
  if (stopAtMs != null) {
    if (rate > 0 && t >= stopAtMs) return { timeMs: clamp(stopAtMs, 0, durationMs), stop: true };
    if (rate < 0 && t <= stopAtMs) return { timeMs: clamp(stopAtMs, 0, durationMs), stop: true };
  }

  if (rate > 0 && t >= hi) {
    if (!loop) return { timeMs: hi, stop: true };
    // Carry the overshoot so a wrap doesn't silently drop part of a frame.
    const span = hi - lo;
    const over = span > 0 ? (t - hi) % span : 0;
    return { timeMs: clamp(lo + over, lo, hi), stop: false };
  }

  if (rate < 0 && t <= lo) {
    if (!loop) return { timeMs: lo, stop: true };
    const span = hi - lo;
    const under = span > 0 ? (lo - t) % span : 0;
    return { timeMs: clamp(hi - under, lo, hi), stop: false };
  }

  return { timeMs: clamp(t, 0, durationMs), stop: false };
}

/**
 * Pure scheduling math shared by the audio engine's playback paths. Kept free
 * of AudioContext/store/browser globals so it is directly testable — the engine
 * itself can only be exercised in a real browser.
 */

/** Anchor mapping timeline position onto the AudioContext clock. */
export interface ScheduleAnchor {
  ctxTime: number;
  playheadMs: number;
}

export interface ForwardWindow {
  /** Seconds from the anchor's playhead position until playback must begin. */
  delaySec: number;
  /** Read offset into the (forward) decoded buffer. */
  offsetSec: number;
  /** How long to play before stopping. */
  durationSec: number;
}

/**
 * AudioContext time at which timeline position `timeMs` occurs, given an
 * anchor and a signed playback rate. Reverse playback (negative rate) falls
 * out of the same formula, which is why both directions share it.
 */
export function ctxTimeFor(
  anchor: ScheduleAnchor,
  timeMs: number,
  rate: number,
): number {
  return anchor.ctxTime + (timeMs - anchor.playheadMs) / (1000 * rate);
}

/**
 * Where and for how long a clip should play on the forward path, starting from
 * timeline position `fromMs` at rate 1. Returns null when the clip is entirely
 * behind the playhead (half-open: a clip ending exactly at `fromMs` is done).
 */
export function forwardClipWindow(
  clip: {
    startMs: number;
    offsetMs: number;
    durationMs: number;
    sourceDurationMs: number;
    loop: boolean;
  },
  fromMs: number,
): ForwardWindow | null {
  const clipEnd = clip.startMs + clip.durationMs;
  if (clipEnd <= fromMs) return null;

  const enterMs = Math.max(clip.startMs, fromMs);
  let intoClip = enterMs - clip.startMs;
  // A looping clip wraps within the source remaining after its trim-in.
  const srcRemain = clip.sourceDurationMs - clip.offsetMs;
  if (clip.loop && srcRemain > 0) intoClip %= srcRemain;

  return {
    delaySec: (enterMs - fromMs) / 1000,
    offsetSec: (clip.offsetMs + intoClip) / 1000,
    durationSec: (clipEnd - enterMs) / 1000,
  };
}

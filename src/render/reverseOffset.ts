/**
 * Pure offset math for reverse (negative playRate) audio playback. Kept free
 * of AudioContext/store/browser globals so it's directly testable.
 *
 * AudioBufferSourceNode.playbackRate doesn't reliably support negative
 * values, so reverse playback is achieved by reversing a clip's sample data
 * up front (audioCache.ts's getReversedAudioBuffer) and always reading it
 * forward. This module computes where in that reversed buffer to start
 * reading for a given timeline position.
 */

/**
 * At timeline time `fromMs` inside a clip's active window, the corresponding
 * position in the clip's ORIGINAL (forward) source is:
 *   sourcePosMs(t) = clip.offsetMs + (t - clip.startMs)
 * A buffer reversed end-to-start maps original position p to reversed
 * position (sourceDurationMs - p). So the read offset into the REVERSED
 * buffer, to start reverse playback at timeline position `fromMs`, is:
 *   sourceDurationMs - sourcePosMs(fromMs)
 *   = sourceDurationMs - clip.offsetMs - (fromMs - clip.startMs)
 * Clamped to the buffer's valid range for safety at exact window boundaries.
 */
export function reversedBufferOffsetSec(
  clip: { startMs: number; offsetMs: number },
  fromMs: number,
  sourceDurationMs: number,
): number {
  const sourcePosMs = clip.offsetMs + (fromMs - clip.startMs);
  const reversedMs = sourceDurationMs - sourcePosMs;
  return Math.max(0, Math.min(sourceDurationMs, reversedMs)) / 1000;
}

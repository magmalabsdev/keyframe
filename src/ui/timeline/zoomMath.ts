/**
 * Pure timeline zoom/pan math: cursor-centered zoom, view-window clamping,
 * and "nice number" tick spacing. Kept free of stores/DOM so it is directly
 * testable; Timeline.tsx's wheel handler is a thin wrapper around these.
 */

/**
 * The new view-window left edge that keeps `cursorMs` (the time under the
 * pointer before zooming) fixed at the same screen x after zooming to
 * `nextPxPerMs`, given the pointer's offset from the container's left edge.
 */
export function computeZoomViewStart(
  cursorMs: number,
  nextPxPerMs: number,
  clientOffsetPx: number,
): number {
  return cursorMs - clientOffsetPx / nextPxPerMs;
}

/** Clamps a view-window start so the window never goes past 0 or the scene end. */
export function clampViewStart(
  viewStart: number,
  pxPerMs: number,
  containerWidthPx: number,
  durationMs: number,
): number {
  const visibleMs = containerWidthPx / pxPerMs;
  return Math.max(0, Math.min(viewStart, Math.max(0, durationMs - visibleMs)));
}

/** "Nice" (1/2/5/10 * 10^n ms) tick spacing targeting ~`targetPx` between ticks. */
export function tickStepMs(pxPerMs: number, targetPx = 90): number {
  const targetMs = targetPx / pxPerMs;
  const pow = Math.pow(10, Math.floor(Math.log10(targetMs)));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  return candidates.find((c) => c >= targetMs) ?? candidates[candidates.length - 1];
}

/**
 * Formats a tick's time in seconds, with enough decimal places that
 * consecutive ticks (spaced `step` ms apart) are always distinguishable —
 * whole seconds when zoomed out, fractional seconds as `step` shrinks below
 * 1000ms. Without this, sub-second tick steps would render as repeated,
 * rounded-off integer labels.
 */
export function formatTickLabel(t: number, step: number): string {
  const stepSec = step / 1000;
  const decimals = stepSec >= 1 ? 0 : stepSec >= 0.1 ? 1 : stepSec >= 0.01 ? 2 : 3;
  return `${(t / 1000).toFixed(decimals)}s`;
}

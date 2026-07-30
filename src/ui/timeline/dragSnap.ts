/**
 * Pure snap math for "body" drags — moving a whole clip/lifetime rather than
 * trimming one edge. Kept out of Timeline.tsx so it is unit-testable (vitest
 * only collects `.ts`).
 *
 * The subtlety this module exists to get right: snapping the *cursor* and then
 * adding the grab offset back does NOT snap the clip. The cursor lands on the
 * grid, but the clip's edges end up displaced by however far into the clip you
 * happened to press the mouse, so nothing is ever aligned. Standard NLE
 * behavior is the other way round: snap the clip's *edges* and move the cursor
 * relationship, which is what `snapBodyDelta` does.
 */

/**
 * Correction of a raw drag delta so that whichever clip edge is closest to a
 * snap target lands exactly on it. Both edges receive the same correction, so
 * the clip's duration is preserved bit-for-bit.
 *
 * `snap` is a time-domain snapper (an `applyTimelineSnap` closure) that returns
 * its input unchanged when nothing is within the snap threshold. A zero
 * correction therefore means "this edge has no target nearby" and is treated as
 * *no candidate* — not as "already perfectly aligned". Getting that backwards
 * is what made snapping feel entirely absent: during a drag it is normal for
 * one edge to be out of range, and preferring its zero correction would veto
 * the other edge's real one every time.
 *
 * (Consequence worth knowing: an edge that happens to sit exactly on a grid
 * point is indistinguishable from one with no target, so the other edge's snap
 * can pull it off by a few ms. Harmless — the next pointermove re-evaluates —
 * and far better than never snapping at all.)
 */
export function snapBodyDelta(
  startMs: number,
  endMs: number,
  rawDelta: number,
  snap: (ms: number) => number,
): number {
  const candStart = startMs + rawDelta;
  const candEnd = endMs + rawDelta;
  const corrStart = snap(candStart) - candStart;
  const corrEnd = snap(candEnd) - candEnd;
  if (corrStart === 0 && corrEnd === 0) return rawDelta;
  if (corrStart === 0) return rawDelta + corrEnd;
  if (corrEnd === 0) return rawDelta + corrStart;
  // Both edges found a target: the nearer one wins, ties to the leading edge.
  return rawDelta + (Math.abs(corrStart) <= Math.abs(corrEnd) ? corrStart : corrEnd);
}

/**
 * Keeps a leftward body drag from pushing the clip's start below zero without
 * changing its duration. Applied *after* snapping: 0 is itself a grid point
 * for every snap mode, so the clamp can only ever improve alignment.
 */
export function clampDeltaToStart(startMs: number, delta: number): number {
  return Math.max(delta, -startMs);
}

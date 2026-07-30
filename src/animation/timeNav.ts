/**
 * Pure playhead-navigation math: frame snapping, stepping, and finding the
 * neighbouring keyframe/marker time. Kept free of stores so it is directly
 * testable and shared by the transport commands and the timeline UI.
 */
import type { Scene, Tracks } from '../state/types';

/**
 * Tolerance for "is the playhead already at this time". Playback advances by
 * wall-clock deltas and scrubbing is pixel-derived, so times are rarely exact;
 * without this, prev/next would stick on the current keyframe.
 */
export const NAV_EPS_MS = 0.5;

export function frameMsFor(fps: number): number {
  return 1000 / Math.max(1, fps);
}

/** Nearest frame boundary to `ms`. */
export function snapToFrame(ms: number, fps: number): number {
  const frame = frameMsFor(fps);
  return Math.round(ms / frame) * frame;
}

/** Nearest whole-second boundary to `ms`. */
export function snapToSecond(ms: number): number {
  return Math.round(ms / 1000) * 1000;
}

/**
 * Constant screen-space "stickiness" for timeline drag snapping, in px — the
 * threshold is derived per-drag as `TIMELINE_SNAP_PX / pxPerMs`, so the magnet
 * feels the same at every zoom level. For scale: at fit-to-width for a 5s scene
 * on a ~1400px timeline (0.28 px/ms) that is ~43ms; at MAX_PX_PER_MS (5) it is
 * 2.4ms, which is below half a frame — so at deep zoom frame snapping correctly
 * stops being effectively-always-on and becomes a genuine 12px magnet.
 */
export const TIMELINE_SNAP_PX = 12;

export interface TimelineSnapModes {
  second: boolean;
  frame: boolean;
  clip: boolean;
}

/**
 * Snap candidates to leave out — always the item currently being dragged.
 * Without this, a dragged item's own edges are candidates, they sit a fixed
 * distance from the cursor, and clip snapping becomes a self-satisfying no-op
 * that never pulls toward anything else.
 */
export interface SnapExclude {
  /** Objects whose lifetime edges are dropped. Their keyframes are KEPT: a body
   * drag doesn't move keyframes and an edge trim only remaps them on pointerup,
   * so mid-drag they are legitimate stationary targets. */
  objectIds?: string[];
  /** Audio clips whose start and end are dropped. */
  audioClipIds?: string[];
  markerIds?: string[];
  /** Exact times to drop (e.g. the live position of a dragged keyframe). */
  times?: number[];
}

export function clampTime(ms: number, durationMs: number): number {
  return Math.min(durationMs, Math.max(0, ms));
}

/**
 * Steps one frame in `dir`. Snaps first so stepping from an off-grid scrub
 * position lands on the frame grid rather than inheriting the drift.
 */
export function stepFrame(
  ms: number,
  fps: number,
  dir: -1 | 1,
  durationMs: number,
): number {
  const frame = frameMsFor(fps);
  return clampTime(snapToFrame(ms, fps) + dir * frame, durationMs);
}

/** Steps by an arbitrary offset (used for the one-second jumps). */
export function stepMs(ms: number, deltaMs: number, durationMs: number): number {
  return clampTime(ms + deltaMs, durationMs);
}

/** Largest time in `times` strictly before `t`, or null. `times` must be sorted. */
export function prevTimeBefore(
  times: number[],
  t: number,
  eps = NAV_EPS_MS,
): number | null {
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] < t - eps) return times[i];
  }
  return null;
}

/** Smallest time in `times` strictly after `t`, or null. `times` must be sorted. */
export function nextTimeAfter(
  times: number[],
  t: number,
  eps = NAV_EPS_MS,
): number | null {
  for (const time of times) {
    if (time > t + eps) return time;
  }
  return null;
}

/** Sorted, de-duplicated times that have a keyframe on any channel. */
export function keyframeTimes(tracks: Tracks): number[] {
  const set = new Set<number>();
  for (const track of Object.values(tracks)) {
    if (track) for (const k of track) set.add(k.timeMs);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Every "edit point" a "snap to clip" should stick to: object lifetime
 * start/end, audio clip start/end, markers, and every keyframe time across
 * every object's tracks and the camera's tracks. Broad DaVinci-style
 * edit-point set, not just literal lifetime edges.
 */
export function clipBoundaryTimes(scene: Scene, exclude?: SnapExclude): number[] {
  const skipObj = new Set(exclude?.objectIds ?? []);
  const skipClip = new Set(exclude?.audioClipIds ?? []);
  const skipMarker = new Set(exclude?.markerIds ?? []);

  const set = new Set<number>();
  for (const obj of scene.objects) {
    // Lifetime edges are excluded for a dragged object, but its keyframes stay.
    if (!skipObj.has(obj.id)) {
      set.add(obj.lifetime.startMs);
      set.add(obj.lifetime.endMs);
    }
    for (const t of keyframeTimes(obj.tracks)) set.add(t);
  }
  for (const t of keyframeTimes(scene.camera.tracks)) set.add(t);
  for (const track of scene.audioTracks ?? []) {
    for (const clip of track.clips) {
      if (skipClip.has(clip.id)) continue;
      set.add(clip.startMs);
      set.add(clip.startMs + clip.durationMs);
    }
  }
  for (const m of scene.markers ?? []) {
    if (!skipMarker.has(m.id)) set.add(m.timeMs);
  }
  const times = [...set].sort((a, b) => a - b);
  const skipTimes = exclude?.times;
  if (!skipTimes || skipTimes.length === 0) return times;
  return times.filter((t) => !skipTimes.some((s) => Math.abs(s - t) < 1e-6));
}

/**
 * Snaps `ms` to the nearest value in `candidates` if it's within
 * `thresholdMs`; otherwise returns `ms` unchanged.
 */
export function snapToNearest(
  ms: number,
  candidates: number[],
  thresholdMs: number,
): number {
  let best = ms;
  let bestDist = thresholdMs;
  for (const c of candidates) {
    const dist = Math.abs(c - ms);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/**
 * Applies whichever timeline snap modes are active, resolving ties by
 * nearest-wins: every active mode contributes its nearest candidate, then we
 * take the globally closest of those. Returns `ms` unchanged if no mode is
 * active or nothing is within range.
 *
 * Because it is nearest-wins, enabling `frame` alongside `second` effectively
 * hides `second`: the frame grid is never more than half a frame away, so it
 * almost always beats the whole-second candidate. That is by design.
 */
export function applyTimelineSnap(
  ms: number,
  scene: Scene,
  modes: TimelineSnapModes,
  fps: number,
  thresholdMs: number,
  exclude?: SnapExclude,
): number {
  if (!modes.second && !modes.frame && !modes.clip) return ms;
  const candidates: number[] = [];
  if (modes.second) candidates.push(snapToSecond(ms));
  if (modes.frame) candidates.push(snapToFrame(ms, fps));
  if (modes.clip) {
    const nearestClip = snapToNearest(ms, clipBoundaryTimes(scene, exclude), thresholdMs);
    // The `!== ms` guard is load-bearing: pushing `ms` itself would win at
    // distance 0 and suppress the second/frame candidates.
    if (nearestClip !== ms) candidates.push(nearestClip);
  }
  return snapToNearest(ms, candidates, thresholdMs);
}

/**
 * Times the playhead should stop at when jumping keyframe to keyframe: the
 * selection's keyframes if anything is selected, otherwise every object's plus
 * the camera's (so the shortcut still does something useful with no selection).
 */
export function navKeyframeTimes(scene: Scene, selectedIds: string[]): number[] {
  const set = new Set<number>();
  const add = (tracks: Tracks | undefined) => {
    if (tracks) for (const t of keyframeTimes(tracks)) set.add(t);
  };
  if (selectedIds.length > 0) {
    for (const obj of scene.objects) {
      if (selectedIds.includes(obj.id)) add(obj.tracks);
    }
  } else {
    for (const obj of scene.objects) add(obj.tracks);
    add(scene.camera.tracks);
  }
  return [...set].sort((a, b) => a - b);
}

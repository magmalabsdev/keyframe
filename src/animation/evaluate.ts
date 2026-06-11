import type {
  CameraKeyframe,
  CameraState,
  Easing,
  Keyframe,
  SceneObject,
  Transform,
  Vec3,
} from '../state/types';

/** Maps a normalized 0..1 progress through an easing curve. */
export function ease(t: number, mode: Easing): number {
  switch (mode) {
    case 'step':
      return 0; // hold the "from" value until the next keyframe
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'linear':
    default:
      return t;
  }
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lerpVec3(a: Vec3, b: Vec3, f: number): Vec3 {
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
}

/** Finds the segment index i where keys[i].timeMs <= time < keys[i+1].timeMs. */
function segmentIndex(times: number[], time: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Evaluates a transform from a list of keyframes at a given time. Keyframes are
 * assumed sorted by time. Times outside the range clamp to the first/last frame.
 * The easing of the *earlier* keyframe in a segment governs that segment.
 */
export function evaluateKeyframes(
  keyframes: Keyframe[],
  timeMs: number,
): Transform {
  const n = keyframes.length;
  const first = keyframes[0];
  const last = keyframes[n - 1];
  if (timeMs <= first.timeMs) return toTransform(first);
  if (timeMs >= last.timeMs) return toTransform(last);

  const times = keyframes.map((k) => k.timeMs);
  const i = segmentIndex(times, timeMs);
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.timeMs - a.timeMs;
  const raw = span <= 0 ? 0 : (timeMs - a.timeMs) / span;
  const f = ease(raw, a.interpolation);

  return {
    position: lerpVec3(a.position, b.position, f),
    rotation: lerpVec3(a.rotation, b.rotation, f),
    scale: lerpVec3(a.scale, b.scale, f),
  };
}

function toTransform(k: Keyframe): Transform {
  return { position: k.position, rotation: k.rotation, scale: k.scale };
}

/** The transform an object should display at a given scene time. */
export function evaluateObject(object: SceneObject, timeMs: number): Transform {
  if (object.keyframes.length === 0) return object.transform;
  return evaluateKeyframes(object.keyframes, timeMs);
}

/** Whether an object exists (is rendered) at a given scene time. */
export function isObjectActive(object: SceneObject, timeMs: number): boolean {
  return timeMs >= object.lifetime.startMs && timeMs <= object.lifetime.endMs;
}

/** Camera state at a given time, interpolating its keyframes if any. */
export function evaluateCamera(
  cameraDefault: CameraState,
  keyframes: CameraKeyframe[],
  timeMs: number,
): CameraState {
  if (keyframes.length === 0) return cameraDefault;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (timeMs <= first.timeMs) return { position: first.position, target: first.target };
  if (timeMs >= last.timeMs) return { position: last.position, target: last.target };

  const times = keyframes.map((k) => k.timeMs);
  const i = segmentIndex(times, timeMs);
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.timeMs - a.timeMs;
  const raw = span <= 0 ? 0 : (timeMs - a.timeMs) / span;
  const f = ease(raw, a.interpolation);
  return {
    position: lerpVec3(a.position, b.position, f),
    target: lerpVec3(a.target, b.target, f),
  };
}

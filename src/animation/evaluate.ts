import type {
  CameraKeyframe,
  CameraState,
  ChannelKey,
  Easing,
  SceneObject,
  Transform,
  ValueKeyframe,
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

/** Linearly interpolates between two "#rrggbb" hex colors. */
export function lerpColor(a: string, b: string, f: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff;
  const ag = (pa >> 8) & 0xff;
  const ab = pa & 0xff;
  const br = (pb >> 16) & 0xff;
  const bg = (pb >> 8) & 0xff;
  const bb = pb & 0xff;
  const r = Math.round(lerp(ar, br, f));
  const g = Math.round(lerp(ag, bg, f));
  const bl = Math.round(lerp(ab, bb, f));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
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

/** A transform plus the object's color and opacity at a point in time. */
export interface PoseValue extends Transform {
  color: string;
  opacity: number;
}

/** Evaluates a single numeric channel track at a time, clamping at the ends. */
export function evaluateTrack(
  track: ValueKeyframe[] | undefined,
  timeMs: number,
  fallback: number,
): number {
  if (!track || track.length === 0) return fallback;
  const first = track[0];
  const last = track[track.length - 1];
  if (timeMs <= first.timeMs) return first.value as number;
  if (timeMs >= last.timeMs) return last.value as number;
  const times = track.map((k) => k.timeMs);
  const i = segmentIndex(times, timeMs);
  const a = track[i];
  const b = track[i + 1];
  const span = b.timeMs - a.timeMs;
  const raw = span <= 0 ? 0 : (timeMs - a.timeMs) / span;
  const f = ease(raw, a.interpolation);
  return lerp(a.value as number, b.value as number, f);
}

/** Evaluates a color channel track (hex values) at a time. */
export function evaluateColorTrack(
  track: ValueKeyframe[] | undefined,
  timeMs: number,
  fallback: string,
): string {
  if (!track || track.length === 0) return fallback;
  const first = track[0];
  const last = track[track.length - 1];
  if (timeMs <= first.timeMs) return first.value as string;
  if (timeMs >= last.timeMs) return last.value as string;
  const times = track.map((k) => k.timeMs);
  const i = segmentIndex(times, timeMs);
  const a = track[i];
  const b = track[i + 1];
  const span = b.timeMs - a.timeMs;
  const raw = span <= 0 ? 0 : (timeMs - a.timeMs) / span;
  const f = ease(raw, a.interpolation);
  return lerpColor(a.value as string, b.value as string, f);
}

const AXIS_CHANNELS: Record<'position' | 'rotation' | 'scale', ChannelKey[]> = {
  position: ['position.0', 'position.1', 'position.2'],
  rotation: ['rotation.0', 'rotation.1', 'rotation.2'],
  scale: ['scale.0', 'scale.1', 'scale.2'],
};

function evalAxes(
  tracks: SceneObject['tracks'],
  channels: ChannelKey[],
  timeMs: number,
  base: Vec3,
): Vec3 {
  return [
    evaluateTrack(tracks[channels[0]], timeMs, base[0]),
    evaluateTrack(tracks[channels[1]], timeMs, base[1]),
    evaluateTrack(tracks[channels[2]], timeMs, base[2]),
  ];
}

/** The transform + color + opacity an object should display at a given scene time. */
export function evaluateObject(object: SceneObject, timeMs: number): PoseValue {
  const tracks = object.tracks ?? {};
  const { transform, material } = object;
  return {
    position: evalAxes(tracks, AXIS_CHANNELS.position, timeMs, transform.position),
    rotation: evalAxes(tracks, AXIS_CHANNELS.rotation, timeMs, transform.rotation),
    scale: evalAxes(tracks, AXIS_CHANNELS.scale, timeMs, transform.scale),
    color: evaluateColorTrack(tracks.color, timeMs, material.color),
    opacity: evaluateTrack(tracks.opacity, timeMs, material.opacity),
  };
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

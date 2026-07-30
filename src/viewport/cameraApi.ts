import * as THREE from 'three';
import type CameraControls from 'camera-controls';
import type { CameraState, Vec3 } from '../state/types';
import { useEditorStore } from '../state/editorStore';
import { getR3F } from '../render/renderApi';

/**
 * Module singleton that exposes the active CameraControls instance (and the main
 * camera) to UI that lives outside the R3F Canvas — the view buttons and the
 * orientation cube. The CameraRig / Viewport register these on mount.
 */
let controls: CameraControls | null = null;
let mainCamera: THREE.Camera | null = null;

const _pos = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _offset = new THREE.Vector3();

/** Closest the camera may sit to its orbit target before zoom turns into a
 * fly-through (target pushes forward, distance holds). Millimetres. */
export const MIN_DISTANCE = 20;
/** Furthest the camera may pull back. ~125x the 1600mm build plate — far enough
 * to never feel capped, close enough that you cannot get lost in empty space. */
export const MAX_DISTANCE = 200000;

/**
 * Near/far planes sized to the camera's current distance.
 *
 * Fixed planes cannot work in a millimetre-scale world: `near = 1` silently
 * clips anything within 1mm of the camera, which reads as "zoom stopped" when
 * you push into a small part, and a 500000:1 far/near ratio leaves so little
 * depth precision that the plate z-fights when you pull back.
 */
export function clipPlanesFor(distance: number): { near: number; far: number } {
  const d = Number.isFinite(distance) && distance > 0 ? distance : 1200;
  return {
    near: THREE.MathUtils.clamp(d * 0.01, 0.05, 50),
    far: Math.max(d * 50, 20000),
  };
}

/** Camera->target distance, falling back to the default framing distance when
 * controls report something unusable (0 during init, NaN mid-transition). */
export function safeDistance(distance: number | undefined): number {
  return Number.isFinite(distance) && (distance as number) > 0
    ? (distance as number)
    : 1200;
}

/**
 * Yaw/pitch (degrees, Z-up) of the look direction from `position` to `target`.
 * A convenience *display* transform only — the stored, keyframed value is
 * always `target`, so this never risks desyncing from it. Degenerate when
 * position ≈ target (zero-length look direction); falls back to level (0, 0)
 * rather than propagating NaN into the inspector fields.
 */
export function orientationAngles(position: Vec3, target: Vec3): { yawDeg: number; pitchDeg: number } {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return { yawDeg: 0, pitchDeg: 0 };
  return {
    yawDeg: THREE.MathUtils.radToDeg(Math.atan2(dy, dx)),
    pitchDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dz / dist, -1, 1))),
  };
}

/**
 * Inverse of `orientationAngles`: the target point that puts the look direction
 * at the given yaw/pitch, `distance` away from `position`. `distance` is
 * whatever the current position->target length already is, so editing an angle
 * holds the look-distance fixed rather than changing it as a side effect.
 */
export function targetFromAngles(position: Vec3, yawDeg: number, pitchDeg: number, distance: number): Vec3 {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const d = Math.max(distance, MIN_DISTANCE);
  const cp = Math.cos(pitch);
  return [
    position[0] + cp * Math.cos(yaw) * d,
    position[1] + cp * Math.sin(yaw) * d,
    position[2] + Math.sin(pitch) * d,
  ];
}

/** Current camera position + target, for keyframing the camera. */
export function getCameraState(): CameraState | null {
  if (!controls) return null;
  controls.getPosition(_pos);
  controls.getTarget(_tgt);
  return {
    position: [_pos.x, _pos.y, _pos.z],
    target: [_tgt.x, _tgt.y, _tgt.z],
  };
}

export function registerControls(c: CameraControls | null): void {
  controls = c;
}

/**
 * Reproduce the camera's *current* view as a plain position/target pair with no
 * focal offset in play.
 *
 * `setOrbitPoint` (used for orbit-around-cursor) parks a permanent world-space
 * `focalOffset` on the controls, and `update()` adds it to the camera position
 * *after* the spherical placement. Because that offset is a fixed length it does
 * not shrink as the orbit radius does, so zooming in asymptotes to
 * `target + focalOffset` — an invisible floor whose size depends on where you
 * last right-clicked. Reading the position and forward axis back out of the
 * post-offset world matrix lets us rebuild the identical view with the offset
 * folded into the target, so the floor disappears with no visible jump.
 */
export function recenteredLookAt(
  camera: THREE.Camera,
  pivot: THREE.Vector3 | null,
  fallbackDistance: number,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  camera.updateMatrixWorld();
  const position = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const forward = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()))
    .normalize();
  // Keep the depth the user pivoted around: project the pivot onto the view axis.
  const depth = pivot
    ? _fwd.copy(pivot).sub(position).dot(forward)
    : fallbackDistance;
  const d = THREE.MathUtils.clamp(
    Number.isFinite(depth) ? depth : fallbackDistance,
    MIN_DISTANCE,
    MAX_DISTANCE,
  );
  return {
    position,
    target: forward.clone().multiplyScalar(d).add(position),
  };
}

/** Fold any focal offset back into the target, leaving the view unchanged. */
export function recenterOrbitTarget(pivot: THREE.Vector3 | null): void {
  const c = controls;
  const camera = mainCamera;
  if (!c || !camera) return;
  if (c.getFocalOffset(_offset).lengthSq() === 0) return;
  const { position, target } = recenteredLookAt(camera, pivot, safeDistance(c.distance));
  void c.setFocalOffset(0, 0, 0, false);
  void c.setLookAt(
    position.x, position.y, position.z,
    target.x, target.y, target.z,
    false,
  );
}

/** Move the camera to a stored camera state (position + target). */
export function applyCameraState(state: CameraState): void {
  // setLookAt does not clear focalOffset, so a stale orbit offset would ride
  // along into keyframe playback and skew every restored camera pose.
  void controls?.setFocalOffset(0, 0, 0, false);
  void controls?.setLookAt(
    state.position[0],
    state.position[1],
    state.position[2],
    state.target[0],
    state.target[1],
    state.target[2],
    true,
  );
}

export function getControls(): CameraControls | null {
  return controls;
}

export function registerCamera(c: THREE.Camera | null): void {
  mainCamera = c;
}

export function getMainCamera(): THREE.Camera | null {
  return mainCamera;
}

export type ViewName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

/** World-center the named view should look at: the selected part's bounding-box
 * center if exactly one object is selected, otherwise the scene origin. */
function focusCenter(): THREE.Vector3 {
  const center = new THREE.Vector3(0, 0, 0);
  const { selectedIds } = useEditorStore.getState();
  const scene = getR3F()?.scene;
  if (selectedIds.length === 1 && scene) {
    const mesh = scene.getObjectByName(selectedIds[0]);
    if (mesh) new THREE.Box3().setFromObject(mesh).getCenter(center);
  }
  return center;
}

/** Snap the camera to a named orthographic-style view (Z-up world), framed on
 * the selected part's center (or the origin). */
export function setView(name: ViewName): void {
  const c = controls;
  if (!c) return;
  void c.setFocalOffset(0, 0, 0, false);
  const dist = safeDistance(c.distance);
  const center = focusCenter();
  // Direction offsets from the focus point for each named view. Z is up.
  const offsets: Record<ViewName, [number, number, number]> = {
    top: [0, 0, dist],
    bottom: [0, 0, -dist],
    front: [0, -dist, 0],
    back: [0, dist, 0],
    right: [dist, 0, 0],
    left: [-dist, 0, 0],
    iso: [dist * 0.6, -dist * 0.6, dist * 0.6],
  };
  const [dx, dy, dz] = offsets[name];
  void c.setLookAt(
    center.x + dx,
    center.y + dy,
    center.z + dz,
    center.x,
    center.y,
    center.z,
    true,
  );
}

/** Frame the given objects in view (zoom-to-fit). Used after importing. */
export function frameObjects(ids: string[]): void {
  const c = controls;
  const scene = getR3F()?.scene;
  if (!c || !scene || ids.length === 0) return;
  const box = new THREE.Box3();
  let found = false;
  for (const id of ids) {
    const mesh = scene.getObjectByName(id);
    if (mesh) {
      box.expandByObject(mesh);
      found = true;
    }
  }
  if (found && !box.isEmpty()) {
    void c.fitToBox(box, true, {
      paddingTop: 0.15,
      paddingBottom: 0.15,
      paddingLeft: 0.15,
      paddingRight: 0.15,
    });
  }
}

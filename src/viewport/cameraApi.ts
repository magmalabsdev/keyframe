import { Vector3 } from 'three';
import type CameraControls from 'camera-controls';
import type { CameraState } from '../state/types';

/**
 * Module singleton that exposes the active CameraControls instance to UI that
 * lives outside the R3F Canvas (e.g. the right-bar view buttons / perspective
 * cube). The CameraRig registers the instance on mount.
 */
let controls: CameraControls | null = null;

const _pos = new Vector3();
const _tgt = new Vector3();

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

export function getControls(): CameraControls | null {
  return controls;
}

export type ViewName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

/** Snap the camera to a named orthographic-style view (Z-up world). */
export function setView(name: ViewName): void {
  const c = controls;
  if (!c) return;
  const dist = c.distance && Number.isFinite(c.distance) ? c.distance : 1200;
  // Camera position offsets from the origin for each named view. Z is up.
  const positions: Record<ViewName, [number, number, number]> = {
    top: [0, 0, dist],
    bottom: [0, 0, -dist],
    front: [0, -dist, 0],
    back: [0, dist, 0],
    right: [dist, 0, 0],
    left: [-dist, 0, 0],
    iso: [dist * 0.6, -dist * 0.6, dist * 0.6],
  };
  const [x, y, z] = positions[name];
  void c.setLookAt(x, y, z, 0, 0, 0, true);
}

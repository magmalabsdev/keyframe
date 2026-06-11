import * as THREE from 'three';
import type CameraControls from 'camera-controls';
import type { CameraState } from '../state/types';
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

/** Move the camera to a stored camera state (position + target). */
export function applyCameraState(state: CameraState): void {
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
  const dist = c.distance && Number.isFinite(c.distance) ? c.distance : 1200;
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

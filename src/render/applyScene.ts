import * as THREE from 'three';
import type { Scene } from '../state/types';
import {
  evaluateCamera,
  evaluateObject,
  isObjectActive,
} from '../animation/evaluate';

const d2r = THREE.MathUtils.degToRad;

/**
 * Deterministically poses the three.js scene for a given scene time. Used by the
 * frame-by-frame video exporter (and reusable for any off-loop rendering).
 * Only moves the camera when the scene has camera keyframes — otherwise the
 * current viewport camera is kept.
 */
export function applySceneAtTime(
  sceneData: Scene,
  timeMs: number,
  threeScene: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
): void {
  for (const obj of sceneData.objects) {
    const mesh = threeScene.getObjectByName(obj.id);
    if (!mesh) continue;
    mesh.visible = obj.visible && isObjectActive(obj, timeMs);
    const t = evaluateObject(obj, timeMs);
    mesh.position.set(t.position[0], t.position[1], t.position[2]);
    mesh.rotation.set(d2r(t.rotation[0]), d2r(t.rotation[1]), d2r(t.rotation[2]));
    mesh.scale.set(t.scale[0], t.scale[1], t.scale[2]);
  }

  if (sceneData.camera.keyframes.length > 0) {
    const cam = evaluateCamera(
      sceneData.camera.default,
      sceneData.camera.keyframes,
      timeMs,
    );
    camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
    camera.up.set(0, 0, 1);
    camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    camera.updateMatrixWorld();
  }
}

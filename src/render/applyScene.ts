import * as THREE from 'three';
import type { Scene } from '../state/types';
import { evaluateCamera } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';

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
    const p = poseObjectAtTime(obj, timeMs);
    mesh.visible = p.visible;
    mesh.position.set(p.position[0], p.position[1], p.position[2]);
    mesh.rotation.set(d2r(p.rotation[0]), d2r(p.rotation[1]), d2r(p.rotation[2]));
    mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    if (obj.assetId) {
      const inner = threeScene.getObjectByName(`${obj.id}__mesh`) as
        | THREE.Mesh
        | undefined;
      const mat = inner?.material as THREE.MeshStandardMaterial | undefined;
      if (mat) {
        const opacity = obj.material.opacity * p.opacityMul;
        mat.opacity = opacity;
        mat.transparent = opacity < 1;
      }
    }
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

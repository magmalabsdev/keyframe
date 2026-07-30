import * as THREE from 'three';
import type { Project, Scene } from '../state/types';
import { evaluateCamera } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';
import { resolveVariables } from '../animation/variables';
import { applyObjectPose, buildNameMap } from './applyPose';

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
  project?: Project,
): void {
  const ctx = project
    ? { bindings: project.bindings, vars: resolveVariables(project, timeMs) }
    : undefined;
  const nameMap = buildNameMap(threeScene);
  for (const obj of sceneData.objects) {
    applyObjectPose(nameMap, obj, poseObjectAtTime(obj, timeMs, ctx));
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

import * as THREE from 'three';
import type { Project, Scene } from '../state/types';
import { evaluateCamera, evaluateCameraFov } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';
import { resolveVariables } from '../animation/variables';
import { applyObjectPose, buildNameMap } from './applyPose';
import { clipPlanesFor } from '../viewport/cameraApi';

const _tgt = new THREE.Vector3();

/**
 * Deterministically poses the three.js scene for a given scene time. Used by the
 * frame-by-frame video exporter (and reusable for any off-loop rendering).
 *
 * The camera is always driven from the scene camera (pose + lens), never from
 * wherever the viewport happens to be looking — the same rule the 'camera' view
 * mode follows. It used to apply only when camera tracks existed, which meant a
 * camera positioned in the inspector but never keyframed was ignored by export.
 */
export function applySceneAtTime(
  sceneData: Scene,
  timeMs: number,
  threeScene: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  project?: Project,
): void {
  const objectById = new Map(sceneData.objects.map((o) => [o.id, o]));
  const ctx = project
    ? { bindings: project.bindings, vars: resolveVariables(project, timeMs), objectById }
    : { bindings: {}, vars: {}, objectById };
  const nameMap = buildNameMap(threeScene);
  for (const obj of sceneData.objects) {
    applyObjectPose(nameMap, obj, poseObjectAtTime(obj, timeMs, ctx));
  }

  const cam = evaluateCamera(
    sceneData.camera.default,
    sceneData.camera.tracks,
    timeMs,
  );
  camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
  camera.up.set(0, 0, 1);
  camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
  // CameraRig normally keeps the clip planes sized to the camera distance, but
  // it runs off the render loop, which is stopped during export.
  const { near, far } = clipPlanesFor(
    camera.position.distanceTo(
      _tgt.set(cam.target[0], cam.target[1], cam.target[2]),
    ),
  );
  const fov = evaluateCameraFov(sceneData.camera, timeMs);
  if (camera.near !== near || camera.far !== far || camera.fov !== fov) {
    camera.near = near;
    camera.far = far;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}

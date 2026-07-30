/**
 * World-space <-> local-space Transform conversion for a single object,
 * composed purely from the document (each ancestor's own keyframe-evaluated
 * transform), not from the live mounted three.js scene graph.
 *
 * Reading the live scene graph was deliberately avoided: it reflects idle
 * animations (rotate/pulse/wiggle), so numbers shown in an inspector field
 * would jitter while an idle animation plays even though nothing is being
 * edited. Composing from `evaluateObject` (keyframes only, no idle/transition
 * effects) matches what's actually editable — the same value
 * `applyTransformEdit` would write.
 *
 * Mirrors the world<->local matrix pattern already used by
 * `scene/grouping.ts`'s `ungroupOne` (matrixWorld + invert + decompose).
 */
import * as THREE from 'three';
import { evaluateObject } from './evaluate';
import type { Scene, SceneObject, Transform, Vec3 } from '../state/types';

const d2r = THREE.MathUtils.degToRad;
const r2d = THREE.MathUtils.radToDeg;

function findObject(scene: Scene, id: string): SceneObject | undefined {
  return scene.objects.find((o) => o.id === id);
}

/** This object's own local transform at `timeMs`, as a compose-able matrix. */
function localMatrixOf(obj: SceneObject, timeMs: number): THREE.Matrix4 {
  const pose = evaluateObject(obj, timeMs);
  const position = new THREE.Vector3(...pose.position);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(d2r(pose.rotation[0]), d2r(pose.rotation[1]), d2r(pose.rotation[2]), 'XYZ'),
  );
  const scale = new THREE.Vector3(...pose.scale);
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

/** World matrix of `objectId`, composed by walking up its parent chain. */
export function worldMatrixOf(scene: Scene, objectId: string, timeMs: number): THREE.Matrix4 {
  const obj = findObject(scene, objectId);
  if (!obj) return new THREE.Matrix4();
  const local = localMatrixOf(obj, timeMs);
  if (!obj.parentId) return local;
  return worldMatrixOf(scene, obj.parentId, timeMs).multiply(local);
}

function matrixToTransform(m: THREE.Matrix4): Transform {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(position, quaternion, scale);
  const e = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: [position.x, position.y, position.z],
    rotation: [r2d(e.x), r2d(e.y), r2d(e.z)],
    scale: [scale.x, scale.y, scale.z],
  };
}

/**
 * World-space Transform of `objectId` at `timeMs`, composed from its own and
 * every ancestor's keyframe-evaluated local transform. Equals the object's
 * local transform exactly for a top-level object (no parent).
 */
export function worldTransformOf(scene: Scene, objectId: string, timeMs: number): Transform {
  return matrixToTransform(worldMatrixOf(scene, objectId, timeMs));
}

/**
 * Converts a desired WORLD transform for `objectId` into the LOCAL transform
 * `applyTransformEdit` expects, given the same ancestor chain at `timeMs`.
 *
 * Because `local = inverse(parentWorld) * world`, changing only the object's
 * own world rotation while holding its world position fixed leaves the
 * resulting local position unchanged (and vice versa) — editing one of
 * Position/Rotation in absolute mode cannot perturb the other.
 */
export function localFromWorldTransform(
  scene: Scene,
  objectId: string,
  timeMs: number,
  world: Transform,
): Transform {
  const position = new THREE.Vector3(...(world.position as Vec3));
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(d2r(world.rotation[0]), d2r(world.rotation[1]), d2r(world.rotation[2]), 'XYZ'),
  );
  const scale = new THREE.Vector3(...(world.scale as Vec3));
  const worldMatrix = new THREE.Matrix4().compose(position, quaternion, scale);

  const obj = findObject(scene, objectId);
  const parentWorld = obj?.parentId
    ? worldMatrixOf(scene, obj.parentId, timeMs)
    : new THREE.Matrix4();
  const localMatrix = parentWorld.clone().invert().multiply(worldMatrix);
  return matrixToTransform(localMatrix);
}

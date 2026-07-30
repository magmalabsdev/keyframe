import * as THREE from 'three';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { applyTransformEdit } from '../animation/transformEdit';
import type { Vec3 } from '../state/types';

const r2d = THREE.MathUtils.radToDeg;
const DOWN = new THREE.Vector3(0, 0, -1);

/**
 * Bambu-style "place on face": rotate the object so the clicked face points down
 * (−Z). Position is left unchanged — only orientation changes.
 */
export function placeObjectFaceDown(
  objectId: string,
  mesh: THREE.Object3D,
  faceNormalLocal: THREE.Vector3,
): void {
  const obj = getActiveScene(useDocumentStore.getState().project).objects.find(
    (o) => o.id === objectId,
  );
  if (!obj) return;

  mesh.updateMatrixWorld(true);
  const worldNormal = faceNormalLocal
    .clone()
    .transformDirection(mesh.matrixWorld)
    .normalize();

  const rotateToDown = new THREE.Quaternion().setFromUnitVectors(worldNormal, DOWN);
  const curWorld = new THREE.Quaternion();
  mesh.getWorldQuaternion(curWorld);
  const newWorld = rotateToDown.clone().multiply(curWorld);

  // Convert the new world rotation to local (relative to the parent group).
  let localQuat = newWorld.clone();
  if (mesh.parent) {
    const parentWorld = new THREE.Quaternion();
    mesh.parent.getWorldQuaternion(parentWorld);
    localQuat = parentWorld.invert().multiply(newWorld);
  }
  const euler = new THREE.Euler().setFromQuaternion(localQuat, 'XYZ');
  const rotation: Vec3 = [r2d(euler.x), r2d(euler.y), r2d(euler.z)];

  applyTransformEdit(objectId, {
    position: obj.transform.position,
    rotation,
    scale: obj.transform.scale,
  });
}

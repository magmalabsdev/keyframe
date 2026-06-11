import * as THREE from 'three';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { applyTransformEdit } from '../animation/transformEdit';
import type { Vec3 } from '../state/types';

const r2d = THREE.MathUtils.radToDeg;
const DOWN = new THREE.Vector3(0, 0, -1);

/**
 * Bambu-style "place on face": rotate the object so the clicked face points down
 * (−Z), then rest it on the build plate (world bbox minZ → 0). Keeps X/Y origin.
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

  // Apply the rotation on the live mesh to measure the resulting world minZ.
  const savedQuat = mesh.quaternion.clone();
  mesh.quaternion.copy(localQuat);
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const minZ = box.min.z;
  mesh.quaternion.copy(savedQuat);

  const position: Vec3 = [
    obj.transform.position[0],
    obj.transform.position[1],
    obj.transform.position[2] - minZ,
  ];
  const rotation: Vec3 = [r2d(euler.x), r2d(euler.y), r2d(euler.z)];

  applyTransformEdit(objectId, { position, rotation, scale: obj.transform.scale });
}

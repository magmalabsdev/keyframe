import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';

/** World position of the pivot handle while editing the center of rotation. */
const pivotWorld = new THREE.Vector3();

/**
 * Re-pivot the object: make the dragged handle position the new rotation center
 * (= object origin) while keeping the geometry visually fixed.
 */
export function commitCenterOfRotation(
  objectId: string,
  scene: THREE.Object3D,
): void {
  const node = scene.getObjectByName(objectId);
  const obj = getActiveScene(useDocumentStore.getState().project).objects.find(
    (o) => o.id === objectId,
  );
  if (!node || !obj) return;
  node.updateMatrixWorld(true);

  // Geometry anchor (world) currently sits at M · centerOfRotation.
  const M = node.matrixWorld.clone();
  const anchor = new THREE.Vector3(...obj.centerOfRotation).applyMatrix4(M);

  // New matrix with origin at the handle, same rotation/scale.
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  M.decompose(pos, quat, scl);
  const Mp = new THREE.Matrix4().compose(pivotWorld.clone(), quat, scl);
  const newCor = anchor.clone().applyMatrix4(Mp.clone().invert());

  // Convert the world pivot to the object's parent-local space.
  const localP = pivotWorld.clone();
  if (obj.parentId) {
    const parentNode = scene.getObjectByName(obj.parentId);
    if (parentNode) {
      parentNode.updateMatrixWorld(true);
      localP.applyMatrix4(parentNode.matrixWorld.clone().invert());
    }
  }

  const doc = useDocumentStore.getState();
  doc.setObjectTransform(objectId, {
    position: [localP.x, localP.y, localP.z],
    rotation: obj.transform.rotation,
    scale: obj.transform.scale,
  });
  doc.setObjectCenterOfRotation(objectId, [newCor.x, newCor.y, newCor.z]);
}

/** Draggable sphere marking the center of rotation while editing it. */
export function PivotHandle() {
  const corEditId = useEditorStore((s) => s.corEditId);
  const scene = useThree((s) => s.scene);
  const [group, setGroup] = useState<THREE.Group | null>(null);

  useEffect(() => {
    if (!corEditId || !group) return;
    const node = scene.getObjectByName(corEditId);
    if (node) {
      node.updateMatrixWorld(true);
      node.getWorldPosition(pivotWorld);
      group.position.copy(pivotWorld);
    }
  }, [corEditId, scene, group]);

  if (!corEditId) return null;

  return (
    <>
      <group ref={setGroup}>
        <mesh>
          <sphereGeometry args={[14, 16, 16]} />
          <meshBasicMaterial
            color="#ffaa00"
            depthTest={false}
            transparent
            opacity={0.9}
          />
        </mesh>
      </group>
      {group && (
        <TransformControls
          object={group}
          mode="translate"
          size={0.7}
          onObjectChange={() => pivotWorld.copy(group.position)}
        />
      )}
    </>
  );
}

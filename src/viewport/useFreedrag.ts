import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { applyTransformEdit } from '../animation/transformEdit';
import { trySnap } from '../scene/snapping';
import { topLevelAncestor } from '../scene/tree';

// Set when a freedrag actually moved the object, so the trailing onClick that
// fires on pointer-up doesn't also toggle the selection.
let justDragged = false;
export function consumeJustDragged(): boolean {
  const v = justDragged;
  justDragged = false;
  return v;
}

const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();

/** Where a screen point's ray meets a world plane, or null if they're parallel. */
export function clientToPlane(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  dom: HTMLElement,
  plane: THREE.Plane,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  const rect = dom.getBoundingClientRect();
  _ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  _ray.setFromCamera(_ndc, camera);
  return _ray.ray.intersectPlane(plane, out);
}

/**
 * Roblox-style freedrag: dragging the body of an already-selected object (Move
 * tool) moves it on the two axes facing the camera — the axis most parallel to
 * the view direction (depth) stays fixed.
 */
export function useFreedrag(objectId: string) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  return (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const editor = useEditorStore.getState();
    if (editor.activeTool !== 'move') return;

    const objects = getActiveScene(useDocumentStore.getState().project).objects;
    const targetId = topLevelAncestor(objects, objectId);
    // Only freedrag something already selected (first click selects, then drag).
    if (!editor.selectedIds.includes(targetId)) return;
    const target = scene.getObjectByName(targetId);
    const obj = objects.find((o) => o.id === targetId);
    if (!target || !obj) return;

    e.stopPropagation();

    // Excluded (depth) axis = the world axis most parallel to the view direction.
    const viewDir = new THREE.Vector3();
    camera.getWorldDirection(viewDir);
    const comps = [Math.abs(viewDir.x), Math.abs(viewDir.y), Math.abs(viewDir.z)];
    const excluded = comps.indexOf(Math.max(...comps));
    const planeNormal = new THREE.Vector3(
      excluded === 0 ? 1 : 0,
      excluded === 1 ? 1 : 0,
      excluded === 2 ? 1 : 0,
    );

    const targetWorld = new THREE.Vector3();
    target.getWorldPosition(targetWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      planeNormal,
      targetWorld,
    );

    const startHit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, startHit)) return;
    const startLocal = target.position.clone();
    const dom = gl.domElement;
    const hit = new THREE.Vector3();
    let moved = false;

    editor.setDraggingId(targetId);

    const onMove = (ev: PointerEvent) => {
      if (!clientToPlane(ev.clientX, ev.clientY, camera, dom, plane, hit)) return;
      moved = true;
      const delta = hit.clone().sub(startHit);
      target.position.set(
        startLocal.x + delta.x,
        startLocal.y + delta.y,
        startLocal.z + delta.z,
      );
      trySnap(targetId, target, scene, objects);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        justDragged = true;
        applyTransformEdit(targetId, {
          position: target.position.toArray() as [number, number, number],
          rotation: obj.transform.rotation,
          scale: obj.transform.scale,
        });
      }
      useEditorStore.getState().setDraggingId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
}

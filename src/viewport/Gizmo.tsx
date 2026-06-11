import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { useEditorStore } from '../state/editorStore';
import { applyTransformEdit } from '../animation/transformEdit';

const r2d = THREE.MathUtils.radToDeg;
const ROTATION_SNAP_DEG = 15;

/**
 * Transform gizmo for the single selected object. Move = translate, Scale and
 * Rotate map to the matching modes. Holding Shift snaps rotation to 15° and makes
 * scaling uniform. The gizmo mutates the target mesh live; the new transform is
 * committed to the document store (one undo entry) when the drag ends.
 */
export function Gizmo() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.activeTool);
  const hidden = useEditorStore((s) => s.exportProgress != null || s.renderPreview);
  const setDraggingId = useEditorStore((s) => s.setDraggingId);
  const scene = useThree((s) => s.scene);
  const controlsRef = useRef<any>(null);
  const startScale = useRef(new THREE.Vector3(1, 1, 1));
  const [shift, setShift] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Hide the gizmo during a clean render preview / video export, and for the
  // select / place tools (place uses raw face clicks).
  if (hidden || tool === 'select' || tool === 'place' || selectedIds.length !== 1) {
    return null;
  }
  const targetId = selectedIds[0];
  const target = scene.getObjectByName(targetId);
  if (!target) return null;

  const mode =
    tool === 'move' ? 'translate' : tool === 'scale' ? 'scale' : 'rotate';

  const commit = () => {
    applyTransformEdit(targetId, {
      position: target.position.toArray() as [number, number, number],
      rotation: [
        r2d(target.rotation.x),
        r2d(target.rotation.y),
        r2d(target.rotation.z),
      ],
      scale: target.scale.toArray() as [number, number, number],
    });
    setDraggingId(null);
  };

  // Shift + single-axis scale → uniform, relative to the scale at drag start.
  const onObjectChange = () => {
    if (mode !== 'scale' || !shift) return;
    const axis = controlsRef.current?.axis as string | undefined;
    const i = axis === 'X' ? 0 : axis === 'Y' ? 1 : axis === 'Z' ? 2 : -1;
    if (i < 0) return;
    const start = startScale.current;
    const s0 = start.getComponent(i) || 1;
    const ratio = target.scale.getComponent(i) / s0;
    target.scale.set(start.x * ratio, start.y * ratio, start.z * ratio);
  };

  return (
    <TransformControls
      ref={controlsRef}
      object={target as THREE.Object3D}
      mode={mode}
      size={0.85}
      rotationSnap={shift ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null}
      onMouseDown={() => {
        setDraggingId(targetId);
        startScale.current.copy(target.scale);
      }}
      onObjectChange={onObjectChange}
      onMouseUp={commit}
    />
  );
}

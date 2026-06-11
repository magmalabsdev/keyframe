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
 * Rotate map to the matching modes. Holding Shift snaps rotation to 15°.
 * The gizmo mutates the target mesh live; the new transform is committed to the
 * document store (one undo entry) when the drag ends.
 */
export function Gizmo() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.activeTool);
  const setDraggingId = useEditorStore((s) => s.setDraggingId);
  const scene = useThree((s) => s.scene);
  const controlsRef = useRef<any>(null);
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

  if (tool === 'select' || selectedIds.length !== 1) return null;
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

  return (
    <TransformControls
      ref={controlsRef}
      object={target as THREE.Object3D}
      mode={mode}
      size={0.85}
      rotationSnap={shift ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null}
      onMouseDown={() => setDraggingId(targetId)}
      onMouseUp={commit}
    />
  );
}

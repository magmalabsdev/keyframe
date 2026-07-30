import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { useEditorStore } from '../state/editorStore';
import { applyTransformEdit } from '../animation/transformEdit';
import { composeRotation, RingAngleTracker, shouldUseAngular } from './ringRotation';

const r2d = THREE.MathUtils.radToDeg;
const ROTATION_SNAP_DEG = 15;
const _white = new THREE.Color(1, 1, 1);

/** State frozen at the start of a rotation drag our solver has taken over. */
interface RingOverride {
  space: 'local' | 'world';
  unitAxis: THREE.Vector3;
  quaternionStart: THREE.Quaternion;
  parentQuaternionInv: THREE.Quaternion;
}

/**
 * Tints a gizmo mode's axis handles toward pastel (lerp to white) when
 * `pastel` is true, or restores their original colors when false. Both `color`
 * and `tempColor` are written because three-stdlib restores each handle's color
 * from `tempColor` every frame in updateMatrixWorld. Used as the visual cue for
 * "you're in relative/local-axis mode" on both Move and Rotate handles.
 */
function setGizmoPastel(controls: any, mode: 'translate' | 'rotate', pastel: boolean) {
  const group = controls?.gizmo?.gizmo?.[mode] as THREE.Object3D | undefined;
  if (!group) return;
  group.traverse((handle: any) => {
    const mat = handle.material as (THREE.Material & { color?: THREE.Color; tempColor?: THREE.Color }) | undefined;
    if (!mat || !mat.color) return;
    if (!mat.userData.baseColor) {
      mat.userData.baseColor = (mat.tempColor ?? mat.color).clone();
    }
    const base = mat.userData.baseColor as THREE.Color;
    const next = pastel ? base.clone().lerp(_white, 0.5) : base.clone();
    mat.color.copy(next);
    mat.tempColor = next.clone();
  });
}

/**
 * Transform gizmo for the single selected object. Move = translate, Scale and
 * Rotate map to the matching modes. Move and Rotate handles align to the
 * object's own axes ("relative") or world axes ("absolute") per the inspector
 * toggle (`editorStore.transformSpace`), with pastel-tinted handles as the
 * visual cue for relative. Scale is always local, per three.js's
 * TransformControls.
 *
 * Shift means one thing per tool, deliberately not two: it snaps rotation to
 * 15°, makes scaling uniform, and — in Move only, where it has no other
 * meaning — momentarily flips the axis space. Overloading it onto rotation's
 * space as well used to make tapping Shift mid-drag jump the object between
 * two non-commuting quaternion compositions.
 *
 * Rotation rings are driven by our own angular solver (see ringRotation.ts)
 * whenever a ring faces the camera, where three's tangent-projection math is
 * degenerate. The gizmo mutates the target mesh live; the new transform is
 * committed to the document store (one undo entry) when the drag ends.
 */
export function Gizmo() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.activeTool);
  const transformSpace = useEditorStore((s) => s.transformSpace);
  const hidden = useEditorStore((s) => s.exportProgress != null || s.renderPreview);
  const setDraggingId = useEditorStore((s) => s.setDraggingId);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<any>(null);
  const startScale = useRef(new THREE.Vector3(1, 1, 1));
  const ringRef = useRef<RingOverride | null>(null);
  const trackerRef = useRef(new RingAngleTracker());
  const [shift, setShift] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false);
    };
    // Without this, Cmd-Tabbing away with Shift held leaves it stuck on.
    const blur = () => setShift(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Relative (local-axis) mode for Move/Rotate: the persistent inspector toggle.
  // Shift also flips it, but only for Move — in Rotate, Shift already means
  // "snap to 15°", and driving `space` from it too made mid-drag taps jump the
  // object between two different quaternion compositions. Scale is excluded
  // entirely: three.js always scales in local space whatever `space` says.
  const relative =
    tool !== 'scale' && (transformSpace === 'relative') !== (shift && tool === 'move');
  useEffect(() => {
    if (!controlsRef.current || (tool !== 'move' && tool !== 'rotate')) return;
    setGizmoPastel(controlsRef.current, tool === 'move' ? 'translate' : 'rotate', relative);
    invalidate();
  }, [relative, tool, selectedIds, invalidate]);

  // Hide the gizmo during a clean render preview / video export, and for the
  // select / place / surface tools (those act on raw face clicks).
  if (
    hidden ||
    tool === 'select' ||
    tool === 'place' ||
    tool === 'surface' ||
    selectedIds.length !== 1
  ) {
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

  /**
   * Takes over a rotation drag when the grabbed ring faces the camera, where
   * three's tangent-projection angle is degenerate (see ringRotation.ts).
   * Runs at drag start, while `pointStart` / `quaternionStart` are freshly
   * captured and before any pointermove can move the object.
   */
  const beginRingDrag = () => {
    ringRef.current = null;
    const controls = controlsRef.current;
    if (!controls || mode !== 'rotate') return;

    const axis = controls.axis as string | undefined;
    if (axis !== 'X' && axis !== 'Y' && axis !== 'Z' && axis !== 'E') return;

    const space: 'local' | 'world' = relative ? 'local' : 'world';
    // The E ring spins about the view direction; the others about their own
    // unit axis, oriented by the object when we're working in local space.
    const unitAxis =
      axis === 'E'
        ? controls.eye.clone()
        : new THREE.Vector3(axis === 'X' ? 1 : 0, axis === 'Y' ? 1 : 0, axis === 'Z' ? 1 : 0);
    const axisWorld =
      axis === 'E'
        ? controls.eye.clone()
        : space === 'local'
          ? unitAxis.clone().applyQuaternion(controls.worldQuaternionStart)
          : unitAxis.clone();

    if (!shouldUseAngular(axisWorld, controls.eye)) return;
    if (!trackerRef.current.begin(controls.pointStart, axisWorld)) return;

    ringRef.current = {
      // 'E' rotates about the view axis in world terms whatever the toggle says.
      space: axis === 'E' ? 'world' : space,
      unitAxis,
      quaternionStart: controls.quaternionStart.clone(),
      parentQuaternionInv: controls.parentQuaternionInv.clone(),
    };
  };

  const onObjectChange = () => {
    const controls = controlsRef.current;

    // Rotation: recompute the angle ourselves and overwrite what three wrote.
    const ring = ringRef.current;
    if (ring && controls) {
      let angle = trackerRef.current.update(controls.pointEnd);
      const snap = controls.rotationSnap as number | null;
      if (snap) angle = Math.round(angle / snap) * snap;
      composeRotation(
        ring.space,
        ring.quaternionStart,
        ring.unitAxis,
        ring.parentQuaternionInv,
        angle,
        target.quaternion,
      );
      return;
    }

    // Shift + single-axis scale → uniform, relative to the scale at drag start.
    if (mode !== 'scale' || !shift) return;
    const axis = controls?.axis as string | undefined;
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
      space={relative ? 'local' : 'world'}
      size={0.85}
      rotationSnap={shift ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null}
      onMouseDown={() => {
        setDraggingId(targetId);
        startScale.current.copy(target.scale);
        beginRingDrag();
      }}
      onObjectChange={onObjectChange}
      onMouseUp={() => {
        ringRef.current = null;
        trackerRef.current.reset();
        commit();
      }}
    />
  );
}

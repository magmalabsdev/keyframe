import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { clientToPlane } from './useFreedrag';
import type { Point2 } from '../state/types';

const VERTEX_RADIUS = 7;
const MIDPOINT_RADIUS = 4;
/** Lifts handles off the polygon so they read clearly against its fill (mm). */
const HANDLE_Z = 1;

const _plane = new THREE.Plane();
const _hit = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _origin = new THREE.Vector3();

/**
 * Draggable polygon vertices for the surface being shape-edited.
 *
 * Rendered as a top-level overlay that mirrors the surface's world matrix each
 * frame, rather than as a child of the surface's own group: React owns that
 * group and the pose driver writes to it every frame, so handles parented
 * there would fight both.
 */
export function SurfaceHandles() {
  const editId = useEditorStore((s) => s.surfaceEditId);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const groupRef = useRef<THREE.Group>(null);

  const surface = useDocumentStore((s) => {
    if (!editId) return undefined;
    return getActiveScene(s.project).objects.find((o) => o.id === editId)?.surface;
  });
  const preview = useEditorStore((s) => s.surfacePreviewPoints);
  const points = preview ?? surface?.points;

  useFrame(() => {
    const group = groupRef.current;
    if (!group || !editId) return;
    const node = scene.getObjectByName(editId);
    if (!node) return;
    node.updateMatrixWorld(true);
    group.matrixAutoUpdate = false;
    group.matrix.copy(node.matrixWorld);
  });

  if (!editId || !points || points.length < 3) return null;

  /** The surface's own plane in world space, plus its world->local inverse. */
  function surfaceFrame(): { inverse: THREE.Matrix4 } | null {
    const node = scene.getObjectByName(editId!);
    if (!node) return null;
    node.updateMatrixWorld(true);
    const matrix = node.matrixWorld;
    _normal.set(0, 0, 1).transformDirection(matrix).normalize();
    _origin.setFromMatrixPosition(matrix);
    _plane.setFromNormalAndCoplanarPoint(_normal, _origin);
    return { inverse: matrix.clone().invert() };
  }

  function commit(next: Point2[]) {
    useEditorStore.getState().setSurfacePreviewPoints(null);
    useDocumentStore.getState().setObjectSurface(editId!, { points: next });
  }

  function startDrag(index: number, e: ThreeEvent<PointerEvent>) {
    const frame = surfaceFrame();
    if (!frame || !e.ray.intersectPlane(_plane, _hit)) return;

    const grab = _hit.clone().applyMatrix4(frame.inverse);
    const origin = points![index];
    const live = points!.map((p) => [...p] as Point2);
    const dom = gl.domElement;
    const setPreview = useEditorStore.getState().setSurfacePreviewPoints;

    const onMove = (ev: PointerEvent) => {
      if (!clientToPlane(ev.clientX, ev.clientY, camera, dom, _plane, _hit)) return;
      const local = _hit.clone().applyMatrix4(frame.inverse);
      live[index] = [origin[0] + (local.x - grab.x), origin[1] + (local.y - grab.y)];
      // Preview lives in the editor store, which is outside undo history, so a
      // drag records one entry on release instead of one per pointermove.
      setPreview(live.map((p) => [...p] as Point2));
      invalidate();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      commit(live);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const midpoints = points.map((p, i) => {
    const next = points[(i + 1) % points.length];
    return [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2] as Point2;
  });

  return (
    <group ref={groupRef}>
      {points.map((p, i) => (
        <mesh
          key={`v${i}`}
          position={[p[0], p[1], HANDLE_Z]}
          renderOrder={999}
          userData={{ excludeFromRender: true }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            // Alt-click removes, keeping at least a triangle. Right-click is
            // unavailable here: the viewport claims it for the context menu.
            if (e.altKey) {
              if (points.length > 3) commit(points.filter((_, j) => j !== i));
              return;
            }
            startDrag(i, e);
          }}
        >
          <sphereGeometry args={[VERTEX_RADIUS, 16, 12]} />
          <meshBasicMaterial color="#ffaa00" depthTest={false} toneMapped={false} />
        </mesh>
      ))}
      {midpoints.map((p, i) => (
        <mesh
          key={`m${i}`}
          position={[p[0], p[1], HANDLE_Z]}
          renderOrder={999}
          userData={{ excludeFromRender: true }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const next = [...points];
            next.splice(i + 1, 0, p);
            commit(next);
          }}
        >
          <sphereGeometry args={[MIDPOINT_RADIUS, 12, 8]} />
          <meshBasicMaterial
            color="#7fd67f"
            depthTest={false}
            toneMapped={false}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
  );
}

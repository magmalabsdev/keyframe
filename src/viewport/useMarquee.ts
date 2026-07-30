import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { getR3F } from '../render/renderApi';

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _box = new THREE.Box3();
const _corner = new THREE.Vector3();

/**
 * True if `object` or an ancestor is an interactive TransformControls handle.
 * Deliberately excludes the gizmo's giant invisible drag plane: that plane is
 * raycast-hit (three doesn't skip invisible meshes) and, being screen-sized,
 * would otherwise occlude all empty space and block marquee/deselect whenever a
 * gizmo is shown. Pressing empty plane area does nothing in TransformControls
 * anyway (no handle under the pointer → no drag), so it's safe to marquee there.
 */
function isOnGizmoHandle(object: THREE.Object3D | null): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if ((o as any).isTransformControlsPlane) return false;
    if ((o as any).isTransformControlsGizmo) return true;
  }
  return false;
}

function selectInRect(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  rect: DOMRect,
  additive: boolean,
): void {
  const root = getR3F();
  if (!root) return;
  const minX = Math.min(sx, ex);
  const maxX = Math.max(sx, ex);
  const minY = Math.min(sy, ey);
  const maxY = Math.max(sy, ey);

  const objects = getActiveScene(useDocumentStore.getState().project).objects;
  const hits: string[] = [];
  for (const o of objects) {
    if (o.parentId) continue;
    const node = root.scene.getObjectByName(o.id);
    if (!node) continue;
    _box.setFromObject(node);
    if (_box.isEmpty()) continue;
    // Project the object's world AABB corners to screen space and take their
    // bounding rect; a crossing (touch) test against the marquee is far more
    // forgiving than requiring the box's center to land inside it.
    let bMinX = Infinity;
    let bMinY = Infinity;
    let bMaxX = -Infinity;
    let bMaxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      _corner
        .set(
          i & 1 ? _box.max.x : _box.min.x,
          i & 2 ? _box.max.y : _box.min.y,
          i & 4 ? _box.max.z : _box.min.z,
        )
        .project(root.camera);
      const px = rect.left + (_corner.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-_corner.y * 0.5 + 0.5) * rect.height;
      bMinX = Math.min(bMinX, px);
      bMaxX = Math.max(bMaxX, px);
      bMinY = Math.min(bMinY, py);
      bMaxY = Math.max(bMaxY, py);
    }
    if (bMinX <= maxX && bMaxX >= minX && bMinY <= maxY && bMaxY >= minY) {
      hits.push(o.id);
    }
  }

  const editor = useEditorStore.getState();
  if (additive) editor.setSelection([...new Set([...editor.selectedIds, ...hits])]);
  else editor.setSelection(hits);
}

/**
 * Marquee (drag-over) selection, plus empty-click deselect. Attaches a native
 * pointerdown listener to the WebGL canvas so it reliably fires; starts a
 * marquee only when the pointer is over empty space.
 */
export function useMarquee() {
  const [rect, setRect] = useState<MarqueeRect | null>(null);

  useEffect(() => {
    let canvas: HTMLCanvasElement | null = null;
    let raf = 0;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const root = getR3F();
      if (!root) return;
      const r = root.gl.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      _ray.setFromCamera(_ndc, root.camera);
      const onObject = _ray
        .intersectObjects(root.scene.children, true)
        .some((h) => h.object.name?.endsWith('__mesh') || isOnGizmoHandle(h.object));
      if (onObject) return; // object/freedrag/gizmo handles it

      const startX = e.clientX;
      const startY = e.clientY;
      const additive = e.shiftKey;
      let moved = false;

      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
          moved = true;
        }
        setRect({
          x: Math.min(startX, ev.clientX) - r.left,
          y: Math.min(startY, ev.clientY) - r.top,
          w: Math.abs(ev.clientX - startX),
          h: Math.abs(ev.clientY - startY),
        });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setRect(null);
        if (moved) {
          selectInRect(startX, startY, ev.clientX, ev.clientY, r, additive);
        } else if (!additive) {
          useEditorStore.getState().clearSelection(); // empty click deselects
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    const attach = () => {
      const root = getR3F();
      if (!root) {
        raf = requestAnimationFrame(attach);
        return;
      }
      canvas = root.gl.domElement;
      canvas.addEventListener('pointerdown', onDown);
    };
    attach();

    return () => {
      cancelAnimationFrame(raf);
      canvas?.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return { rect };
}

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
const _center = new THREE.Vector3();

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
    _box.getCenter(_center);
    _center.project(root.camera);
    const px = rect.left + (_center.x * 0.5 + 0.5) * rect.width;
    const py = rect.top + (-_center.y * 0.5 + 0.5) * rect.height;
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) hits.push(o.id);
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
        .some((h) => h.object.name?.endsWith('__mesh'));
      if (onObject) return; // object/freedrag handles it

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

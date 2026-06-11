import * as THREE from 'three';
import { useEditorStore } from '../state/editorStore';
import type { SceneObject } from '../state/types';

/** Snap distance in world units (mm). */
const THRESHOLD = 4;

const _movingBox = new THREE.Box3();
const _otherBox = new THREE.Box3();

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && aMax > bMin;
}

/**
 * Object snapping: when a moving object's axis-aligned face comes within the
 * threshold of another object's parallel face (and they overlap on the other two
 * axes), nudge the moving object so the faces touch. Mutates target.position.
 */
export function trySnap(
  targetId: string,
  target: THREE.Object3D,
  scene: THREE.Object3D,
  objects: SceneObject[],
): void {
  if (!useEditorStore.getState().snapEnabled) return;

  target.updateMatrixWorld(true);
  _movingBox.setFromObject(target);
  const mvMin = [_movingBox.min.x, _movingBox.min.y, _movingBox.min.z];
  const mvMax = [_movingBox.max.x, _movingBox.max.y, _movingBox.max.z];

  let bestAxis = -1;
  let bestShift = 0;
  let bestDist = THRESHOLD;

  for (const o of objects) {
    if (o.id === targetId || o.parentId) continue; // top-level others only
    const m = scene.getObjectByName(o.id);
    if (!m || !m.visible) continue;
    _otherBox.setFromObject(m);
    if (_otherBox.isEmpty()) continue;
    const oMin = [_otherBox.min.x, _otherBox.min.y, _otherBox.min.z];
    const oMax = [_otherBox.max.x, _otherBox.max.y, _otherBox.max.z];

    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      const c = (a + 2) % 3;
      if (
        !rangesOverlap(mvMin[b], mvMax[b], oMin[b], oMax[b]) ||
        !rangesOverlap(mvMin[c], mvMax[c], oMin[c], oMax[c])
      ) {
        continue;
      }
      // moving +face to other -face, and moving -face to other +face
      const candidates = [oMin[a] - mvMax[a], oMax[a] - mvMin[a]];
      for (const shift of candidates) {
        const dist = Math.abs(shift);
        if (dist < bestDist) {
          bestDist = dist;
          bestAxis = a;
          bestShift = shift;
        }
      }
    }
  }

  if (bestAxis >= 0) {
    target.position.setComponent(
      bestAxis,
      target.position.getComponent(bestAxis) + bestShift,
    );
    target.updateMatrixWorld(true);
  }
}

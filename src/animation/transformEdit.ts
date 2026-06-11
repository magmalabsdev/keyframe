import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { Transform } from '../state/types';
import { evaluateObject } from './evaluate';

function findObject(objectId: string) {
  const project = useDocumentStore.getState().project;
  return getActiveScene(project).objects.find((o) => o.id === objectId);
}

/**
 * Apply a transform edit from a gizmo or inspector. If the object is animated
 * (has keyframes) the edit upserts a keyframe at the playhead (auto-key);
 * otherwise it updates the object's static base transform.
 */
export function applyTransformEdit(objectId: string, transform: Transform): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const doc = useDocumentStore.getState();
  if (obj.keyframes.length > 0) {
    doc.upsertKeyframe(objectId, useEditorStore.getState().playheadMs, transform);
  } else {
    doc.setObjectTransform(objectId, transform);
  }
}

/** Capture an object's current pose into a keyframe at the playhead. */
export function addKeyframeAtPlayhead(objectId: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const timeMs = useEditorStore.getState().playheadMs;
  const transform = evaluateObject(obj, timeMs);
  useDocumentStore.getState().upsertKeyframe(objectId, timeMs, transform);
}

/** Add a keyframe at the playhead for every selected object. */
export function keyframeSelection(): void {
  const { selectedIds } = useEditorStore.getState();
  selectedIds.forEach(addKeyframeAtPlayhead);
}

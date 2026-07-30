import { nanoid } from 'nanoid';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { descendantIds } from '../scene/tree';
import type { SceneObject } from '../state/types';

/** In-app clipboard for scene objects (not the OS clipboard). */
let clipboard: SceneObject[] = [];

/** Whether there is anything to paste. */
export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

/** Selected objects plus all descendants of any selected group. */
function selectionWithDescendants(): SceneObject[] {
  const { selectedIds } = useEditorStore.getState();
  const objects = getActiveScene(useDocumentStore.getState().project).objects;
  const ids = new Set(selectedIds);
  for (const id of selectedIds) for (const d of descendantIds(objects, id)) ids.add(d);
  return objects.filter((o) => ids.has(o.id));
}

export function copySelection(): void {
  clipboard = selectionWithDescendants().map((o) => structuredClone(o));
}

export function deleteSelection(): void {
  const { selectedIds, clearSelection } = useEditorStore.getState();
  if (selectedIds.length === 0) return;
  useDocumentStore.getState().removeObjects(selectedIds);
  clearSelection();
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

export function pasteClipboard(): void {
  if (clipboard.length === 0) return;
  // Remap ids so cloned groups keep their parent/child links internally.
  const idMap = new Map<string, string>();
  for (const o of clipboard) idMap.set(o.id, nanoid());

  const clones = clipboard.map((o) => {
    const c = structuredClone(o);
    c.id = idMap.get(o.id)!;
    c.parentId = o.parentId && idMap.has(o.parentId) ? idMap.get(o.parentId)! : null;
    // Offset only the roots (children move with their parent group).
    if (!c.parentId) {
      c.name = `${o.name} copy`;
      c.transform = {
        ...c.transform,
        position: [
          c.transform.position[0] + 20,
          c.transform.position[1] - 20,
          c.transform.position[2],
        ],
      };
    }
    return c;
  });

  useDocumentStore.getState().addObjects(clones);
  const newRootIds = clones.filter((c) => !c.parentId).map((c) => c.id);
  useEditorStore.getState().setSelection(newRootIds);
}

export function selectAll(): void {
  // Select only top-level objects (children belong to their group).
  const scene = getActiveScene(useDocumentStore.getState().project);
  useEditorStore.getState().setSelection(
    scene.objects.filter((o) => !o.parentId).map((o) => o.id),
  );
}

export function duplicateSelection(): void {
  copySelection();
  pasteClipboard();
}

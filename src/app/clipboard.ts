import { nanoid } from 'nanoid';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { SceneObject } from '../state/types';

/** In-app clipboard for scene objects (not the OS clipboard). */
let clipboard: SceneObject[] = [];

function selectedObjects(): SceneObject[] {
  const { selectedIds } = useEditorStore.getState();
  const scene = getActiveScene(useDocumentStore.getState().project);
  return scene.objects.filter((o) => selectedIds.includes(o.id));
}

export function copySelection(): void {
  clipboard = selectedObjects().map((o) => structuredClone(o));
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
  const clones = clipboard.map((o) => {
    const c = structuredClone(o);
    c.id = nanoid();
    c.name = `${o.name} copy`;
    c.transform = {
      ...c.transform,
      position: [
        c.transform.position[0] + 20,
        c.transform.position[1] - 20,
        c.transform.position[2],
      ],
    };
    return c;
  });
  useDocumentStore.getState().addObjects(clones);
  useEditorStore.getState().setSelection(clones.map((c) => c.id));
}

export function selectAll(): void {
  const scene = getActiveScene(useDocumentStore.getState().project);
  useEditorStore.getState().setSelection(scene.objects.map((o) => o.id));
}

export function duplicateSelection(): void {
  copySelection();
  pasteClipboard();
}

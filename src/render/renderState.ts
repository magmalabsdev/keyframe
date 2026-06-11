import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { Project } from '../state/types';

/** The project reference captured at the last "Render". Immer changes the
 * reference on any edit, so a simple identity check detects modifications. */
let lastRenderProject: Project | null = null;

/** Play the entire scene from the start (the "Render" button). */
export function startRender(): void {
  const editor = useEditorStore.getState();
  editor.setPlayhead(0);
  editor.setPlaying(true);
  lastRenderProject = useDocumentStore.getState().project;
}

export function hasRendered(): boolean {
  return lastRenderProject != null;
}

export function isModifiedSinceRender(): boolean {
  return lastRenderProject !== useDocumentStore.getState().project;
}

export function markRendered(): void {
  lastRenderProject = useDocumentStore.getState().project;
}

import { get, set } from 'idb-keyval';
import {
  clearHistory,
  getActiveScene,
  useDocumentStore,
} from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { Project } from '../state/types';
import { buildGeometry, putGeometry } from './geometryCache';
import {
  parseProjectContainer,
  serializeProject,
} from './serialize';

const AUTOSAVE_KEY = 'keyframe:autosave';
const AUTOSAVE_DEBOUNCE_MS = 700;

/** Rebuild runtime geometry for every asset in a loaded project. */
function hydrateGeometries(project: Project): void {
  for (const asset of Object.values(project.assets)) {
    putGeometry(asset.id, buildGeometry(asset.geometry));
  }
}

let savedTimer: ReturnType<typeof setTimeout> | undefined;

async function writeAutosave(): Promise<void> {
  const editor = useEditorStore.getState();
  editor.setSaveStatus('saving');
  try {
    await set(AUTOSAVE_KEY, useDocumentStore.getState().project);
    editor.setSaveStatus('saved');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => editor.setSaveStatus('idle'), 1500);
  } catch {
    editor.setSaveStatus('idle');
  }
}

/** Subscribe to document changes and debounce-persist to IndexedDB. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return useDocumentStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void writeAutosave(), AUTOSAVE_DEBOUNCE_MS);
  });
}

/** Force an immediate save (used by Cmd/Ctrl+S). */
export async function saveNow(): Promise<void> {
  await writeAutosave();
}

/** Restore the autosaved project, if any. Returns true if restored. */
export async function restoreAutosave(): Promise<boolean> {
  const project = await get<Project>(AUTOSAVE_KEY);
  if (!project || !project.scenes?.length) return false;
  hydrateGeometries(project);
  useDocumentStore.getState().setProject(project);
  clearHistory();
  return true;
}

function triggerDownload(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_') || 'project';
}

/** Export the active scene as a self-contained .kfp file. */
export function exportActiveScene(): void {
  const project = useDocumentStore.getState().project;
  const scene = getActiveScene(project);
  const bytes = serializeProject(project, [scene.id]);
  triggerDownload(`${safeName(scene.name)}.kfp`, bytes);
}

/** Export all scenes as a self-contained .kfpx file. */
export function exportProject(): void {
  const project = useDocumentStore.getState().project;
  const bytes = serializeProject(
    project,
    project.scenes.map((s) => s.id),
  );
  triggerDownload(`${safeName(project.name)}.kfpx`, bytes);
}

/** Open a .kfp/.kfpx file, replacing the current project. */
export async function openProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { project, geometries } = parseProjectContainer(bytes);
  for (const [id, geometry] of geometries) putGeometry(id, geometry);
  useDocumentStore.getState().setProject(project);
  clearHistory();
  useEditorStore.getState().clearSelection();
  useEditorStore.getState().setPlayhead(0);
}

import { del, get, set, setMany } from 'idb-keyval';
import {
  clearHistory,
  getActiveScene,
  useDocumentStore,
} from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { GeometryData, Project } from '../state/types';
import { migrateProject } from '../state/migrate';
import { buildGeometry, getGeometryData, hasGeometry, putGeometry, putGeometryData } from './geometryCache';
import { putMedia } from './mediaCache';
import { decodeAudio } from './audioCache';
import {
  parseProjectContainer,
  serializeProject,
} from './serialize';

const AUTOSAVE_KEY = 'keyframe:autosave';
const MEDIA_KEY_PREFIX = 'keyframe:media:';
const GEOM_KEY_PREFIX = 'keyframe:geom:';

/** Persist one asset's geometry to IndexedDB (written once on import, not per edit). */
export async function persistGeometry(id: string, data: GeometryData): Promise<void> {
  await set(GEOM_KEY_PREFIX + id, data);
}

const idle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (ric) ric(fn);
  else setTimeout(fn, 0);
};

/**
 * Persist many geometries in small batches during idle time. Used after a large
 * import so the IndexedDB structured-clone of every buffer never blocks the
 * critical path (the geometry is already in the caches for rendering).
 */
export function persistGeometriesDeferred(entries: Array<[string, GeometryData]>): void {
  const queue = entries.map(
    ([id, data]) => [GEOM_KEY_PREFIX + id, data] as [IDBValidKey, GeometryData],
  );
  const BATCH = 24;
  const step = () => {
    if (queue.length === 0) return;
    void setMany(queue.splice(0, BATCH)).finally(() => {
      if (queue.length) idle(step);
    });
  };
  idle(step);
}

/** Remove an asset's persisted geometry. */
export async function deleteGeometry(id: string): Promise<void> {
  await del(GEOM_KEY_PREFIX + id);
}
const AUTOSAVE_DEBOUNCE_MS = 700;

/**
 * Rebuild runtime geometry for every asset in a loaded project. Geometry lives
 * in its own IndexedDB entries (not in the project doc); load any that aren't
 * already cached (migration may have already populated the cache from a legacy
 * in-project geometry).
 */
async function hydrateGeometries(project: Project): Promise<void> {
  for (const asset of Object.values(project.assets)) {
    if (hasGeometry(asset.id)) continue;
    const data = await get<GeometryData>(GEOM_KEY_PREFIX + asset.id);
    if (data) {
      putGeometryData(asset.id, data);
      putGeometry(asset.id, buildGeometry(data));
    }
  }
}

/** Reload uploaded media blobs from IndexedDB for every media asset in a loaded project. */
async function hydrateMedia(project: Project): Promise<void> {
  for (const media of Object.values(project.media ?? {})) {
    const blob = await get<Blob>(MEDIA_KEY_PREFIX + media.id);
    if (!blob) continue;
    putMedia(media.id, blob);
    // Audio also needs decoding into the audio cache so it can play/export.
    if (media.kind === 'audio') {
      void decodeAudio(media.id, blob).catch(() => {});
    }
  }
}

/** Persist an uploaded media blob to IndexedDB so it survives a reload. */
export async function persistMediaBlob(id: string, blob: Blob): Promise<void> {
  await set(MEDIA_KEY_PREFIX + id, blob);
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
  project.media ??= {};
  // migrate may move legacy in-project geometry into the caches; persist those
  // to their own IDB entries so subsequent loads find them out-of-doc.
  migrateProject(project);
  for (const asset of Object.values(project.assets)) {
    const d = getGeometryData(asset.id);
    if (d) void persistGeometry(asset.id, d);
  }
  await hydrateGeometries(project);
  await hydrateMedia(project);
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
export async function exportActiveScene(): Promise<void> {
  const project = useDocumentStore.getState().project;
  const scene = getActiveScene(project);
  const bytes = await serializeProject(project, [scene.id]);
  triggerDownload(`${safeName(scene.name)}.kfp`, bytes);
}

/** Export all scenes as a self-contained .kfpx file. */
export async function exportProject(): Promise<void> {
  const project = useDocumentStore.getState().project;
  const bytes = await serializeProject(
    project,
    project.scenes.map((s) => s.id),
  );
  triggerDownload(`${safeName(project.name)}.kfpx`, bytes);
}

/** Open a .kfp/.kfpx file, replacing the current project. */
export async function openProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { project } = parseProjectContainer(bytes);
  // parseProjectContainer already populated the geometry caches. Persist each
  // asset's geometry to its own IDB entry so it survives a reload (autosave
  // writes only the light project doc, without geometry).
  for (const asset of Object.values(project.assets)) {
    const d = getGeometryData(asset.id);
    if (d) void persistGeometry(asset.id, d);
  }
  useDocumentStore.getState().setProject(project);
  clearHistory();
  useEditorStore.getState().clearSelection();
  useEditorStore.getState().setPlayhead(0);
}

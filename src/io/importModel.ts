import { nanoid } from 'nanoid';
import { useDocumentStore, getActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { defaultMaterial, identityTransform } from '../state/defaults';
import type { Asset, ModelFormat, SceneObject } from '../state/types';
import { loadModelFile, type LoadedPart } from './loaders';
import { buildGeometry, putGeometry, putGeometryData } from './geometryCache';
import { persistGeometriesDeferred } from './persistence';
import type { GeometryData } from '../state/types';
import { frameObjects } from '../viewport/cameraApi';

/** Normalized model format from a filename (mirrors loadModelFile's mapping). */
function formatForFile(fileName: string): ModelFormat {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  return ext === 'stp' ? 'step' : (ext as ModelFormat);
}

/**
 * Loads a model file and adds it to the active scene. Multi-part files (e.g. a
 * STEP assembly) become several objects, each with its own geometry and the
 * color carried from the file. All parts share one stagger offset so the
 * assembly keeps its relative arrangement.
 *
 * Parts stream in as they load: each batch is mounted as it arrives (instead of
 * one commit at the end) and the background-task HUD shows a running part count,
 * so a large assembly appears progressively and stays responsive.
 */
export async function importModelFile(file: File): Promise<string[]> {
  const taskId = 'model-import';
  const editor = useEditorStore.getState();
  editor.startBackgroundTask(taskId, `Importing ${file.name}…`);

  const format = formatForFile(file.name);
  const doc = useDocumentStore.getState();
  const scene = getActiveScene(doc.project);
  // Stagger offset is fixed for the whole file (computed from the pre-import
  // object count) so all of an assembly's parts keep their relative arrangement.
  const n = scene.objects.length;
  const offset: [number, number, number] = [
    (n % 5) * 60,
    Math.floor(n / 5) * -60,
    0,
  ];
  const durationMs = scene.durationMs;

  const ids: string[] = [];
  const toPersist: Array<[string, GeometryData]> = [];

  const mountParts: (parts: LoadedPart[], loaded: number, total: number) => void = (
    parts,
    loaded,
    total,
  ) => {
    const assets: Asset[] = [];
    const objects: SceneObject[] = [];
    for (const part of parts) {
      const assetId = nanoid();
      // Geometry lives only in the caches (+ IDB) — never in the document store.
      putGeometry(assetId, buildGeometry(part.data));
      putGeometryData(assetId, part.data);
      toPersist.push([assetId, part.data]);
      assets.push({ id: assetId, name: part.name, format });

      const transform = identityTransform();
      transform.position = [...offset];
      const material = defaultMaterial();
      if (part.color) material.color = part.color;

      const id = nanoid();
      ids.push(id);
      objects.push({
        id,
        name: part.name,
        type: 'mesh',
        parentId: null,
        assetId,
        visible: true,
        lifetime: { startMs: 0, endMs: durationMs },
        transform,
        tracks: {},
        centerOfRotation: [0, 0, 0],
        material,
      });
    }
    // One commit per batch registers the assets and mounts their meshes.
    useDocumentStore.getState().addImportedModels(assets, objects);
    useEditorStore
      .getState()
      .setBackgroundTaskProgress(
        taskId,
        total > 0 ? loaded / total : null,
        `Loading ${file.name} — ${loaded}/${total} parts`,
      );
  };

  try {
    await loadModelFile(file, editor.importQuality, mountParts);
  } finally {
    useEditorStore.getState().endBackgroundTask(taskId);
  }

  // Persist geometry to IndexedDB off the critical path (batched, during idle).
  persistGeometriesDeferred(toPersist);
  useEditorStore.getState().setSelection(ids);
  // Frame the new objects once React has mounted their meshes.
  setTimeout(() => frameObjects(ids), 90);
  return ids;
}

/** Imports several files in sequence, collecting any failures. */
export async function importModelFiles(
  files: FileList | File[],
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;
  for (const file of Array.from(files)) {
    try {
      await importModelFile(file);
      imported += 1;
    } catch (err) {
      errors.push(`${file.name}: ${(err as Error).message}`);
    }
  }
  return { imported, errors };
}

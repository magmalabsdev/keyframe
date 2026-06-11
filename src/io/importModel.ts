import { nanoid } from 'nanoid';
import { useDocumentStore, getActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { defaultMaterial, identityTransform } from '../state/defaults';
import type { Asset, SceneObject } from '../state/types';
import { loadModelFile } from './loaders';
import { geometryToData, putGeometry } from './geometryCache';
import { frameObjects } from '../viewport/cameraApi';

/**
 * Loads a model file and adds it to the active scene. Multi-part files (e.g. a
 * STEP assembly) become several objects, each with its own geometry and the
 * color carried from the file. All parts share one stagger offset so the
 * assembly keeps its relative arrangement.
 */
export async function importModelFile(file: File): Promise<string[]> {
  const loaded = await loadModelFile(file);

  const scene = getActiveScene(useDocumentStore.getState().project);
  const n = scene.objects.length;
  const offset: [number, number, number] = [
    (n % 5) * 60,
    Math.floor(n / 5) * -60,
    0,
  ];

  const assets: Asset[] = [];
  const objects: SceneObject[] = [];

  for (const part of loaded.parts) {
    const assetId = nanoid();
    putGeometry(assetId, part.geometry);
    assets.push({
      id: assetId,
      name: part.name,
      format: loaded.format,
      geometry: geometryToData(part.geometry),
    });

    const transform = identityTransform();
    transform.position = [...offset];
    const material = defaultMaterial();
    if (part.color) material.color = part.color;

    objects.push({
      id: nanoid(),
      name: part.name,
      type: 'mesh',
      parentId: null,
      assetId,
      visible: true,
      lifetime: { startMs: 0, endMs: scene.durationMs },
      transform,
      keyframes: [],
      centerOfRotation: [0, 0, 0],
      material,
    });
  }

  useDocumentStore.getState().addImportedModels(assets, objects);
  const ids = objects.map((o) => o.id);
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

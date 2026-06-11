import { nanoid } from 'nanoid';
import { useDocumentStore, getActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { defaultMaterial, identityTransform } from '../state/defaults';
import type { Asset, SceneObject } from '../state/types';
import { loadModelFile } from './loaders';
import { geometryToData, putGeometry } from './geometryCache';

/** Loads a model file, registers its geometry, and adds it to the active scene. */
export async function importModelFile(file: File): Promise<string> {
  const loaded = await loadModelFile(file);

  const assetId = nanoid();
  putGeometry(assetId, loaded.geometry);

  const asset: Asset = {
    id: assetId,
    name: loaded.name,
    format: loaded.format,
    geometry: geometryToData(loaded.geometry),
  };

  const scene = getActiveScene(useDocumentStore.getState().project);
  // Stagger successive imports so they don't perfectly overlap on the plate.
  const n = scene.objects.length;
  const transform = identityTransform();
  transform.position = [(n % 5) * 60, Math.floor(n / 5) * -60, 0];

  const object: SceneObject = {
    id: nanoid(),
    name: loaded.name,
    type: 'mesh',
    parentId: null,
    assetId,
    visible: true,
    lifetime: { startMs: 0, endMs: scene.durationMs },
    transform,
    keyframes: [],
    centerOfRotation: [0, 0, 0],
    material: defaultMaterial(),
  };

  useDocumentStore.getState().addImportedModel(asset, object);
  useEditorStore.getState().setSelection([object.id]);
  return object.id;
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

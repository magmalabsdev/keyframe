import { nanoid } from 'nanoid';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { MediaAsset, MediaKind } from '../state/types';
import { putMedia } from './mediaCache';
import { persistMediaBlob } from './persistence';

/** Registers an uploaded image/gif/video file as a media asset and returns its id. */
export async function importMediaFile(file: File, kind: MediaKind): Promise<string> {
  const id = nanoid();
  const taskId = `media-import-${id}`;
  useEditorStore.getState().startBackgroundTask(taskId, `Importing ${file.name}`);
  try {
    const asset: MediaAsset = { id, name: file.name, mimeType: file.type, kind };
    putMedia(id, file);
    useDocumentStore.getState().addMediaAsset(asset);
    await persistMediaBlob(id, file);
    return id;
  } finally {
    useEditorStore.getState().endBackgroundTask(taskId);
  }
}

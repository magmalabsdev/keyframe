import { nanoid } from 'nanoid';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { MediaAsset, MediaKind } from '../state/types';
import { putMedia } from './mediaCache';
import { decodeAudio } from './audioCache';
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

/**
 * Imports an audio file as a media asset and decodes it, returning the new media
 * id plus the source's length in ms (used to size a new AudioClip on the timeline).
 */
export async function importAudioFile(
  file: File,
): Promise<{ mediaId: string; durationMs: number }> {
  const mediaId = await importMediaFile(file, 'audio');
  const buffer = await decodeAudio(mediaId, file);
  return { mediaId, durationMs: buffer.duration * 1000 };
}

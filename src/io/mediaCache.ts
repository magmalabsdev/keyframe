/**
 * Runtime cache mapping mediaId -> Blob (and a derived object URL). Image/video
 * blobs are heavy and non-serializable, so they live here rather than in the
 * document store. The store only holds the serializable MediaAsset metadata.
 */
const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();

export function putMedia(id: string, blob: Blob): void {
  blobs.set(id, blob);
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old);
  urls.set(id, URL.createObjectURL(blob));
}

export function getMediaBlob(id: string): Blob | undefined {
  return blobs.get(id);
}

export function getMediaUrl(id: string): string | undefined {
  return urls.get(id);
}

export function hasMedia(id: string): boolean {
  return blobs.has(id);
}

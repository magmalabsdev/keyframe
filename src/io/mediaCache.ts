/**
 * Runtime cache mapping mediaId -> Blob (and a derived object URL). Image/video
 * blobs are heavy and non-serializable, so they live here rather than in the
 * document store. The store only holds the serializable MediaAsset metadata.
 */
const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();
const listeners = new Set<() => void>();

/** Subscribe to blob arrivals (e.g. fonts hydrating after load). Returns unsubscribe. */
export function subscribeMedia(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function putMedia(id: string, blob: Blob): void {
  blobs.set(id, blob);
  const old = urls.get(id);
  if (old) URL.revokeObjectURL(old);
  urls.set(id, URL.createObjectURL(blob));
  for (const cb of listeners) cb();
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

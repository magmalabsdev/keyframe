/**
 * Runtime cache mapping mediaId -> decoded AudioBuffer, plus the single shared
 * AudioContext used for both decoding and playback. Decoded audio is heavy and
 * non-serializable, so it lives here (mirroring geometryCache / mediaCache); the
 * document store only holds the lightweight MediaAsset metadata + AudioClip
 * placement. The raw Blob is still kept in mediaCache and persisted to IndexedDB.
 */
const buffers = new Map<string, AudioBuffer>();
const decoding = new Map<string, Promise<AudioBuffer>>();
const reversedBuffers = new Map<string, AudioBuffer>();
const listeners = new Set<() => void>();

let ctx: AudioContext | undefined;

/** The shared AudioContext, created lazily. Starts suspended until a gesture. */
export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

/**
 * Decodes an audio blob into an AudioBuffer and caches it by mediaId.
 * Concurrent/repeat calls for the same id share one in-flight decode.
 */
export function decodeAudio(id: string, blob: Blob): Promise<AudioBuffer> {
  const cached = buffers.get(id);
  if (cached) return Promise.resolve(cached);
  const inFlight = decoding.get(id);
  if (inFlight) return inFlight;

  const p = blob
    .arrayBuffer()
    .then((data) => getAudioContext().decodeAudioData(data))
    .then((buffer) => {
      buffers.set(id, buffer);
      decoding.delete(id);
      for (const cb of listeners) cb();
      return buffer;
    })
    .catch((err) => {
      decoding.delete(id);
      throw err;
    });
  decoding.set(id, p);
  return p;
}

/** Subscribe to a clip's audio finishing decode (e.g. to redraw its waveform
 * once PCM becomes available). Returns an unsubscribe. */
export function subscribeAudioDecoded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getAudioBuffer(id: string): AudioBuffer | undefined {
  return buffers.get(id);
}

/**
 * A reversed copy of a decoded clip's PCM (each channel reversed end-to-start),
 * built lazily on first reverse-shuttle need and cached alongside the forward
 * buffer. Used to play audio backward: AudioBufferSourceNode.playbackRate
 * doesn't reliably support negative values, so "reverse" is achieved by
 * reversing the sample data up front and always reading forward.
 */
export function getReversedAudioBuffer(id: string): AudioBuffer | undefined {
  const cached = reversedBuffers.get(id);
  if (cached) return cached;
  const src = buffers.get(id);
  if (!src) return undefined;
  const out = getAudioContext().createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const data = src.getChannelData(ch).slice();
    data.reverse();
    out.copyToChannel(data, ch);
  }
  reversedBuffers.set(id, out);
  return out;
}

export function hasAudioBuffer(id: string): boolean {
  return buffers.has(id);
}

/** Duration of a decoded source in ms, or undefined if not yet decoded. */
export function audioDurationMs(id: string): number | undefined {
  const b = buffers.get(id);
  return b ? b.duration * 1000 : undefined;
}

/**
 * Web Audio playback engine that keeps the timeline's audio tracks in sync with
 * the editor playhead. It subscribes to the editor store (`playing` /
 * `playheadMs` / `playRate`), the document store (audio-track edits), and the
 * media/decode caches, dispatching to one of three scheduling paths:
 *
 *  - `forwardBuffer` (rate === 1): AudioBufferSourceNodes against the decoded
 *    AudioBuffer, scheduled on the AudioContext clock. Buffers are decoded
 *    eagerly at import, so there is no load latency and no metadata race, and
 *    scheduling is sample-accurate. Pitch preservation is meaningless at 1x, so
 *    the element path below buys nothing here — this is the common case and it
 *    gets the precise engine.
 *  - `forwardElement` (rate > 0, rate !== 1): pooled <audio> elements through
 *    MediaElementAudioSourceNodes with `preservesPitch`, the only way to get
 *    pitch-preserving time-stretch. Elements can't be scheduled for a future
 *    time (only "seek + play now"), so this path is a per-tick synchronizer,
 *    re-targeted whenever the playhead updates.
 *  - `reverse` (rate < 0): AudioBufferSourceNodes against a pre-reversed copy of
 *    the PCM at Math.abs(rate) — AudioBufferSourceNode.playbackRate does not
 *    reliably support negative values, so reversal is done to the sample data.
 *    Pitch shifts with speed here; that is expected for reverse shuttling.
 *
 * Elements are warmed ahead of time (on mount, on audio edits, and as media
 * arrives) rather than being constructed at the tick the playhead reaches a
 * clip, which used to leave them at readyState 0 with the seek silently
 * dropped — the clip then began from wherever the playhead had since advanced.
 */
import { useEditorStore } from '../state/editorStore';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import type { AudioClip, AudioTrack, Project } from '../state/types';
import {
  decodeAudio,
  getAudioBuffer,
  getAudioContext,
  getReversedAudioBuffer,
  subscribeAudioDecoded,
} from '../io/audioCache';
import { getMediaBlob, getMediaUrl, subscribeMedia } from '../io/mediaCache';
import { reversedBufferOffsetSec } from './reverseOffset';
import { ctxTimeFor, forwardClipWindow, type ScheduleAnchor } from './forwardSchedule';

/** A playhead jump larger than this (ms) is treated as a seek, not normal advance. */
const SEEK_EPS_MS = 150;
/** Looser than SEEK_EPS_MS: <audio>.currentTime seek/read precision is coarser
 * than Web Audio scheduling, and over-correcting every tick would stutter. */
const FORWARD_DRIFT_EPS_SEC = 0.25;
/** Warm an element this far ahead of its clip during element-path playback. */
const WARM_LEAD_MS = 3000;
/** Cap on live <audio> + MediaElementAudioSourceNode pairs. */
const MAX_WARM_VOICES = 24;

interface ForwardVoice {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  mediaId: string;
  /** The object URL the element was built with. `putMedia` revokes and replaces
   * a media id's URL when a blob is re-hydrated (e.g. reopening a project), and
   * an element holding the revoked URL can never load — so the voice is rebuilt
   * when this no longer matches the cache. */
  url: string;
  /** Metadata loaded, so `currentTime` writes actually land. */
  ready: boolean;
  /** Set on teardown so an in-flight loadedmetadata callback no-ops. */
  dead: boolean;
  onMeta: () => void;
}

/** What a buffer voice was scheduled to do, for debug introspection. */
interface BufferVoiceInfo {
  key: string;
  mediaId: string;
  startAtCtxTime: number;
  offsetSec: number;
  durationSec: number;
}

type Mode = 'stopped' | 'forwardBuffer' | 'forwardElement' | 'reverse';

/** Element voices keyed `${track.id}:${clip.id}`. Pooled because a
 * MediaElementAudioSourceNode can only ever be created once per element. */
const forwardVoices = new Map<string, ForwardVoice>();
let activeForwardBuffer: AudioBufferSourceNode[] = [];
let activeReverse: AudioBufferSourceNode[] = [];
let bufferVoiceInfo: BufferVoiceInfo[] = [];
let anchor: ScheduleAnchor | null = null;
let lastMode: Mode = 'stopped';
let lastPlayRate = 0;
/** Media ids we've already kicked off a decode for. */
let pendingDecode = new Set<string>();
let resyncQueued = false;

function currentTracks(project: Project): AudioTrack[] {
  return getActiveScene(project).audioTracks ?? [];
}

function modeFor(state = useEditorStore.getState()): Mode {
  if (!state.playing || state.playRate === 0) return 'stopped';
  if (state.playRate < 0) return 'reverse';
  return state.playRate === 1 ? 'forwardBuffer' : 'forwardElement';
}

function clipGain(track: AudioTrack, clip: AudioClip): number {
  return track.muted ? 0 : track.gain * clip.gain;
}

/** Kicks off a decode for a clip's source if it isn't cached yet. */
function ensureDecoded(mediaId: string): void {
  if (getAudioBuffer(mediaId) || pendingDecode.has(mediaId)) return;
  const blob = getMediaBlob(mediaId);
  if (!blob) return;
  pendingDecode.add(mediaId);
  void decodeAudio(mediaId, blob).catch(() => {});
}

// ------------------------------------------------------------ element voices

function getOrCreateForwardVoice(
  ctx: AudioContext,
  key: string,
  mediaId: string,
): ForwardVoice | undefined {
  const url = getMediaUrl(mediaId);
  // Blob not hydrated yet; the subscribeMedia listener retries once it arrives.
  if (!url) return undefined;

  const existing = forwardVoices.get(key);
  if (existing && existing.mediaId === mediaId && existing.url === url) return existing;
  if (existing) destroyVoice(key, existing);

  const el = new Audio(url);
  el.preload = 'auto';
  el.preservesPitch = true;
  (el as unknown as { mozPreservesPitch?: boolean }).mozPreservesPitch = true;
  (el as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  const source = ctx.createMediaElementSource(el);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(ctx.destination);

  // HAVE_METADATA (1) or better means currentTime is already seekable.
  const voice: ForwardVoice = {
    el,
    source,
    gain,
    mediaId,
    url,
    ready: el.readyState >= 1,
    dead: false,
    onMeta: () => {},
  };
  voice.onMeta = () => {
    if (voice.dead) return;
    voice.ready = true;
    // Don't seek/play from here: recompute from the live playhead through the
    // normal sync path, so a pause or seek during loading is honored and the
    // target can never be stale.
    resyncSoon();
  };
  el.addEventListener('loadedmetadata', voice.onMeta);
  forwardVoices.set(key, voice);
  return voice;
}

function destroyVoice(key: string, v: ForwardVoice): void {
  v.dead = true;
  v.el.removeEventListener('loadedmetadata', v.onMeta);
  try {
    v.el.pause();
  } catch {
    /* ignore */
  }
  v.el.src = '';
  v.source.disconnect();
  v.gain.disconnect();
  forwardVoices.delete(key);
}

/** Pauses every element voice but keeps it (and its loaded metadata) alive. */
function pauseAllForwardVoices(): void {
  for (const v of forwardVoices.values()) {
    if (!v.el.paused) v.el.pause();
  }
}

function destroyForwardVoices(): void {
  for (const [key, v] of [...forwardVoices]) destroyVoice(key, v);
}

/**
 * Re-targets every clip's element voice for `fromMs`: starting/pausing as clips
 * enter and leave their window, and applying gain and rate fresh every call so
 * live edits and mid-shuttle rate changes need no separate reschedule.
 */
function syncForwardVoices(fromMs: number): void {
  if (modeFor() !== 'forwardElement') return;
  const ctx = getAudioContext();
  const { playRate } = useEditorStore.getState();
  const project = useDocumentStore.getState().project;
  const seen = new Set<string>();

  for (const track of currentTracks(project)) {
    for (const clip of track.clips) {
      const key = `${track.id}:${clip.id}`;
      const clipEndMs = clip.startMs + clip.durationMs;
      const active = fromMs >= clip.startMs && fromMs < clipEndMs;
      if (!active) {
        const v = forwardVoices.get(key);
        if (v && !v.el.paused) v.el.pause();
        // Warm elements just ahead of the playhead so entering their window
        // never has to wait on metadata.
        const untilMs = clip.startMs - fromMs;
        if (untilMs > 0 && untilMs <= WARM_LEAD_MS) {
          seen.add(key);
          getOrCreateForwardVoice(ctx, key, clip.mediaId);
        }
        continue;
      }
      seen.add(key);
      const v = getOrCreateForwardVoice(ctx, key, clip.mediaId);
      if (!v) continue;

      v.gain.gain.value = clipGain(track, clip);
      v.el.playbackRate = playRate;
      // Never write currentTime at readyState 0 — the seek is silently dropped.
      if (!v.ready) continue;

      // Loop via explicit modulo, not `el.loop` (which can only loop the whole
      // element from 0, not from clip.offsetMs).
      const sourceRemainSec = Math.max(0, (clip.sourceDurationMs - clip.offsetMs) / 1000);
      let intoClipSec = (fromMs - clip.startMs) / 1000;
      if (clip.loop && sourceRemainSec > 0) intoClipSec %= sourceRemainSec;
      const targetSec = clip.offsetMs / 1000 + intoClipSec;

      if (v.el.paused || Math.abs(v.el.currentTime - targetSec) > FORWARD_DRIFT_EPS_SEC) {
        v.el.currentTime = targetSec;
        void v.el.play().catch(() => {});
      }
    }
  }

  for (const [key, v] of forwardVoices) {
    if (!seen.has(key) && !v.el.paused) v.el.pause();
  }
}

/**
 * Creates element voices for the clips nearest `playheadMs`, up to the cap, so
 * playback never has to construct one at the moment it is needed. Also kicks
 * off any missing decodes for the buffer paths.
 */
function warmAudio(playheadMs = useEditorStore.getState().playheadMs): void {
  const project = useDocumentStore.getState().project;
  const candidates: { key: string; mediaId: string; dist: number }[] = [];
  for (const track of currentTracks(project)) {
    for (const clip of track.clips) {
      ensureDecoded(clip.mediaId);
      const clipEnd = clip.startMs + clip.durationMs;
      const dist =
        playheadMs < clip.startMs
          ? clip.startMs - playheadMs
          : playheadMs > clipEnd
            ? playheadMs - clipEnd
            : 0;
      candidates.push({ key: `${track.id}:${clip.id}`, mediaId: clip.mediaId, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  // Drop voices for clips that no longer exist, then evict the farthest ones
  // over the cap (an element + its source node are not free).
  const live = new Set(candidates.map((c) => c.key));
  for (const [key, v] of [...forwardVoices]) {
    if (!live.has(key)) destroyVoice(key, v);
  }
  const keep = new Set(candidates.slice(0, MAX_WARM_VOICES).map((c) => c.key));
  for (const [key, v] of [...forwardVoices]) {
    if (!keep.has(key) && v.el.paused) destroyVoice(key, v);
  }

  const ctx = getAudioContext();
  for (const c of candidates.slice(0, MAX_WARM_VOICES)) {
    getOrCreateForwardVoice(ctx, c.key, c.mediaId);
  }
}

// ------------------------------------------------------- forward buffer path

function stopAllForwardBuffer(): void {
  for (const src of activeForwardBuffer) {
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* already stopped */
    }
  }
  activeForwardBuffer = [];
  bufferVoiceInfo = [];
}

/** Schedules one clip at rate 1 against the decoded buffer. */
function scheduleForwardClip(
  ctx: AudioContext,
  track: AudioTrack,
  clip: AudioClip,
  fromMs: number,
  a: ScheduleAnchor,
  key: string,
): void {
  const w = forwardClipWindow(clip, fromMs);
  if (!w) return;

  const buffer = getAudioBuffer(clip.mediaId);
  if (!buffer) {
    ensureDecoded(clip.mediaId);
    return; // the subscribeAudioDecoded listener reschedules once it lands
  }

  const gainNode = ctx.createGain();
  gainNode.gain.value = clipGain(track, clip);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  if (clip.loop) {
    // Matches audioExport.ts so live and exported audio agree.
    src.loop = true;
    src.loopStart = clip.offsetMs / 1000;
    src.loopEnd = buffer.duration;
  }
  src.connect(gainNode).connect(ctx.destination);

  const enterMs = Math.max(clip.startMs, fromMs);
  const startAt = Math.max(ctxTimeFor(a, enterMs, 1), ctx.currentTime);
  src.start(startAt, w.offsetSec);
  src.stop(startAt + w.durationSec);
  src.onended = () => {
    activeForwardBuffer = activeForwardBuffer.filter((s) => s !== src);
  };
  activeForwardBuffer.push(src);
  bufferVoiceInfo.push({
    key,
    mediaId: clip.mediaId,
    startAtCtxTime: startAt,
    offsetSec: w.offsetSec,
    durationSec: w.durationSec,
  });
}

function rescheduleForwardBuffer(fromMs: number): void {
  stopAllForwardBuffer();
  const a = anchor;
  if (!a) return;
  const ctx = getAudioContext();
  const project = useDocumentStore.getState().project;
  for (const track of currentTracks(project)) {
    for (const clip of track.clips) {
      scheduleForwardClip(ctx, track, clip, fromMs, a, `${track.id}:${clip.id}`);
    }
  }
}

// ------------------------------------------------------------ reverse path

function stopAllReverse(): void {
  for (const src of activeReverse) {
    try {
      src.onended = null;
      src.stop();
    } catch {
      /* already stopped */
    }
  }
  activeReverse = [];
}

/** Schedules one clip's reverse playback, reading a pre-reversed buffer forward
 * at Math.abs(rate) — never a negative playbackRate, which is unsupported. */
function scheduleReverseClip(
  ctx: AudioContext,
  track: AudioTrack,
  clip: AudioClip,
  fromMs: number,
  a: ScheduleAnchor,
  rate: number,
): void {
  if (fromMs <= clip.startMs) return; // already exhausted going backward
  const clipEndMs = clip.startMs + clip.durationMs;
  const R = Math.abs(rate);

  const buffer = getReversedAudioBuffer(clip.mediaId);
  if (!buffer) {
    ensureDecoded(clip.mediaId);
    return;
  }

  const gainNode = ctx.createGain();
  gainNode.gain.value = clipGain(track, clip);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = R;
  src.connect(gainNode).connect(ctx.destination);

  const effectiveFromMs = Math.min(fromMs, clipEndMs);
  const offsetSec = reversedBufferOffsetSec(clip, effectiveFromMs, clip.sourceDurationMs);
  const remainTimelineMs = effectiveFromMs - clip.startMs;
  const startAt = Math.max(ctxTimeFor(a, effectiveFromMs, rate), ctx.currentTime);
  src.start(startAt, offsetSec);
  src.stop(startAt + remainTimelineMs / 1000 / R);
  src.onended = () => {
    activeReverse = activeReverse.filter((s) => s !== src);
  };
  activeReverse.push(src);
}

function rescheduleReverse(fromMs: number, rate: number): void {
  stopAllReverse();
  const a = anchor;
  if (!a) return;
  const ctx = getAudioContext();
  const project = useDocumentStore.getState().project;
  for (const track of currentTracks(project)) {
    for (const clip of track.clips) scheduleReverseClip(ctx, track, clip, fromMs, a, rate);
  }
}

// --------------------------------------------------------------- dispatch

/** Reschedules whichever path is live, from the current playhead. */
function rescheduleActive(): void {
  const state = useEditorStore.getState();
  const mode = modeFor(state);
  if (mode === 'stopped') return;
  if (mode === 'forwardElement') {
    syncForwardVoices(state.playheadMs);
    return;
  }
  anchor = { ctxTime: getAudioContext().currentTime, playheadMs: state.playheadMs };
  if (mode === 'forwardBuffer') rescheduleForwardBuffer(state.playheadMs);
  else rescheduleReverse(state.playheadMs, state.playRate);
}

/** Coalesces reschedule requests from async sources (decode/metadata arrival). */
function resyncSoon(): void {
  if (resyncQueued) return;
  resyncQueued = true;
  queueMicrotask(() => {
    resyncQueued = false;
    rescheduleActive();
  });
}

/** Stops whatever the outgoing mode was using. Element voices are only paused,
 * never destroyed, so shuttling between rates never pays a cold start. */
function leaveMode(mode: Mode): void {
  if (mode === 'forwardBuffer') stopAllForwardBuffer();
  else if (mode === 'forwardElement') pauseAllForwardVoices();
  else if (mode === 'reverse') stopAllReverse();
}

function handleTick(fromMs: number): void {
  const state = useEditorStore.getState();
  const mode = modeFor(state);

  if (mode !== lastMode) {
    leaveMode(lastMode);
    lastMode = mode;
    lastPlayRate = state.playRate;
    if (mode === 'stopped') {
      anchor = null;
      return;
    }
    const ctx = getAudioContext();
    const go = () => {
      // Guard against the mode changing again during an async resume.
      if (modeFor() !== mode) return;
      anchor = { ctxTime: getAudioContext().currentTime, playheadMs: fromMs };
      if (mode === 'forwardBuffer') rescheduleForwardBuffer(fromMs);
      else if (mode === 'forwardElement') syncForwardVoices(fromMs);
      else rescheduleReverse(fromMs, state.playRate);
    };
    if (ctx.state === 'suspended') ctx.resume().then(go).catch(go);
    else go();
    return;
  }

  if (mode === 'stopped') return;

  if (mode === 'forwardElement') {
    // Cheap and self-correcting; also how a clip's window entry is detected,
    // since elements have no start(when) equivalent.
    syncForwardVoices(fromMs);
    lastPlayRate = state.playRate;
    return;
  }

  // Buffer-scheduled modes: a rate change is already baked into the scheduled
  // sources' stop() timing, so it needs a fresh reschedule, same as a seek.
  if (state.playRate !== lastPlayRate) {
    lastPlayRate = state.playRate;
    anchor = { ctxTime: getAudioContext().currentTime, playheadMs: fromMs };
    if (mode === 'forwardBuffer') rescheduleForwardBuffer(fromMs);
    else rescheduleReverse(fromMs, state.playRate);
    return;
  }
  if (anchor) {
    const elapsed = (getAudioContext().currentTime - anchor.ctxTime) * 1000 * state.playRate;
    const expected = anchor.playheadMs + elapsed;
    if (Math.abs(fromMs - expected) > SEEK_EPS_MS) {
      anchor = { ctxTime: getAudioContext().currentTime, playheadMs: fromMs };
      if (mode === 'forwardBuffer') rescheduleForwardBuffer(fromMs);
      else rescheduleReverse(fromMs, state.playRate);
    }
  }
}

/**
 * Starts the audio engine's store subscriptions. Returns an unsubscribe that
 * stops playback and detaches listeners. Mount once (see useAudioPlayback).
 */
export function startAudioEngine(): () => void {
  let lastTracks = currentTracks(useDocumentStore.getState().project);

  // Warm ahead of the first play so no clip has to construct its element (or
  // wait on a decode) at the instant the playhead reaches it.
  warmAudio();

  const unsubEditor = useEditorStore.subscribe((state) => {
    handleTick(state.playheadMs);
  });

  // Audio-track edits. immer keeps the audioTracks reference stable for
  // unrelated document edits, so this only fires on real audio changes.
  // Warming happens outside rescheduleActive on purpose: it must also run while
  // stopped, or editing audio while paused warms nothing.
  const unsubDoc = useDocumentStore.subscribe((state) => {
    const tracks = currentTracks(state.project);
    if (tracks === lastTracks) return;
    lastTracks = tracks;
    warmAudio();
    rescheduleActive();
  });

  // Blobs hydrate asynchronously on project load, so a voice may have been
  // skipped for a missing URL; retry as media arrives.
  const unsubMedia = subscribeMedia(() => {
    warmAudio();
    resyncSoon();
  });

  // A late decode should land a buffer schedule without waiting for a tick.
  const unsubDecoded = subscribeAudioDecoded(() => {
    resyncSoon();
  });

  return () => {
    unsubEditor();
    unsubDoc();
    unsubMedia();
    unsubDecoded();
    stopAllForwardBuffer();
    stopAllReverse();
    destroyForwardVoices();
    anchor = null;
    lastMode = 'stopped';
    lastPlayRate = 0;
    pendingDecode = new Set();
  };
}

/** Dev-only introspection for manual/Playwright verification (see devtools.ts). */
export function __debugAudioState() {
  const ctx = getAudioContext();
  const state = useEditorStore.getState();
  return {
    mode: lastMode,
    playRate: state.playRate,
    ctxState: ctx.state,
    ctxTime: ctx.currentTime,
    anchor: anchor ? { ...anchor } : null,
    warmVoiceKeys: [...forwardVoices.keys()].sort(),
    forwardVoices: Array.from(forwardVoices.entries()).map(([key, v]) => ({
      key,
      currentTime: v.el.currentTime,
      playbackRate: v.el.playbackRate,
      preservesPitch: v.el.preservesPitch,
      paused: v.el.paused,
      ready: v.ready,
      readyState: v.el.readyState,
      dead: v.dead,
      hasSrc: v.el.src !== '',
      gain: v.gain.gain.value,
      // Diagnostics for a stale/revoked object URL, which leaves an element
      // permanently at readyState 0.
      urlIsCurrent: v.url === getMediaUrl(v.mediaId),
      networkState: v.el.networkState,
      errorCode: v.el.error?.code ?? null,
    })),
    bufferVoiceCount: activeForwardBuffer.length,
    bufferVoices: bufferVoiceInfo.map((b) => ({ ...b })),
    reverseVoiceCount: activeReverse.length,
  };
}

/** Dev-only: force a warm pass (used by verification scripts). */
export function __warmAudioForTest(): void {
  warmAudio();
}

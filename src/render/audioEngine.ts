/**
 * Web Audio playback engine that keeps the timeline's audio tracks in sync
 * with the editor playhead. It subscribes to the editor store (`playing` /
 * `playheadMs` / `playRate`) and the document store (audio-track edits),
 * dispatching to one of two independent scheduling paths depending on the
 * sign of `playRate`:
 *
 *  - Forward (playRate > 0, any speed): pooled <audio> elements routed
 *    through MediaElementAudioSourceNode, with `preservesPitch` so speed
 *    changes don't shift pitch. <audio> elements can't be scheduled for a
 *    precise *future* time the way AudioBufferSourceNode.start(when) can
 *    (only "seek + play now"), so this path is a per-tick synchronizer,
 *    re-targeted on every playhead update, rather than a schedule-once model.
 *  - Reverse (playRate < 0): the original AudioBufferSourceNode anchor model,
 *    played against a pre-reversed copy of each clip's PCM — reversing the
 *    *sample data*, since AudioBufferSourceNode.playbackRate doesn't
 *    reliably support negative values — at Math.abs(playRate). Pitch shifts
 *    with speed here; that's expected and accepted for reverse shuttling.
 *
 * `playRate === 0` (or not playing) means silence, same as before. Scrubbing
 * while paused is intentionally silent.
 */
import { useEditorStore } from '../state/editorStore';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import type { AudioClip, AudioTrack, Project } from '../state/types';
import {
  decodeAudio,
  getAudioContext,
  getReversedAudioBuffer,
} from '../io/audioCache';
import { getMediaBlob, getMediaUrl } from '../io/mediaCache';
import { reversedBufferOffsetSec } from './reverseOffset';

/** A playhead jump larger than this (ms) is treated as a seek, not normal advance. */
const SEEK_EPS_MS = 150;
/** Looser than SEEK_EPS_MS: <audio>.currentTime seek/read precision is
 * coarser than Web Audio scheduling, and over-correcting every tick would
 * cause audible stutter. */
const FORWARD_DRIFT_EPS_SEC = 0.25;

interface Anchor {
  ctxTime: number;
  playheadMs: number;
}

interface ForwardVoice {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  mediaId: string;
}

type Mode = 'stopped' | 'forward' | 'reverse';

/** Forward voices, keyed by `${track.id}:${clip.id}` — persistent across
 * reschedules; a MediaElementAudioSourceNode can only be created once per
 * <audio> element, so pooling is mandatory, not an optimization. */
const forwardVoices = new Map<string, ForwardVoice>();
let activeReverse: AudioBufferSourceNode[] = [];
let anchor: Anchor | null = null;
let lastMode: Mode = 'stopped';
let lastPlayRate = 0;
/** Media ids we've already kicked off a lazy decode for during this playback. */
let pendingDecode = new Set<string>();

function currentTracks(project: Project): AudioTrack[] {
  return getActiveScene(project).audioTracks ?? [];
}

function modeFor(state = useEditorStore.getState()): Mode {
  if (!state.playing || state.playRate === 0) return 'stopped';
  return state.playRate > 0 ? 'forward' : 'reverse';
}

// ------------------------------------------------------------ forward path

function getOrCreateForwardVoice(
  ctx: AudioContext,
  key: string,
  mediaId: string,
): ForwardVoice | undefined {
  const existing = forwardVoices.get(key);
  if (existing && existing.mediaId === mediaId) return existing;
  if (existing) {
    existing.el.pause();
    existing.source.disconnect();
    existing.gain.disconnect();
    forwardVoices.delete(key);
  }
  const url = getMediaUrl(mediaId);
  if (!url) return undefined; // blob not hydrated yet — retried next tick

  const el = new Audio(url);
  el.preload = 'auto';
  el.preservesPitch = true;
  (el as unknown as { mozPreservesPitch?: boolean }).mozPreservesPitch = true;
  (el as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  const source = ctx.createMediaElementSource(el);
  const gain = ctx.createGain();
  source.connect(gain).connect(ctx.destination);
  const voice: ForwardVoice = { el, source, gain, mediaId };
  forwardVoices.set(key, voice);
  return voice;
}

/** Re-targets every clip's forward voice to the correct position for `fromMs`,
 * starting/pausing voices as clips enter/leave the active window, and
 * applying the current gain/rate every call so live edits and mid-shuttle
 * rate changes take effect with no separate reschedule step. */
function syncForwardVoices(fromMs: number): void {
  const ctx = getAudioContext();
  const { playRate } = useEditorStore.getState();
  const project = useDocumentStore.getState().project;
  const seen = new Set<string>();

  for (const track of currentTracks(project)) {
    for (const clip of track.clips) {
      const key = `${track.id}:${clip.id}`;
      const clipEndMs = clip.startMs + clip.durationMs;
      if (fromMs < clip.startMs || fromMs >= clipEndMs) {
        const v = forwardVoices.get(key);
        if (v && !v.el.paused) v.el.pause();
        continue;
      }
      seen.add(key);
      const v = getOrCreateForwardVoice(ctx, key, clip.mediaId);
      if (!v) continue;

      v.gain.gain.value = track.muted ? 0 : track.gain * clip.gain;
      v.el.playbackRate = playRate;

      // Loop handling via explicit modulo (not `el.loop`, which can only loop
      // the whole element from 0, not from clip.offsetMs) — recomputed fresh
      // every tick, so no separate "did we wrap" bookkeeping is needed.
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

function teardownForwardVoices(): void {
  for (const v of forwardVoices.values()) {
    v.el.pause();
    v.el.src = '';
    v.source.disconnect();
    v.gain.disconnect();
  }
  forwardVoices.clear();
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

/** Schedules one clip's reverse playback so it lands at the right wall-clock
 * offset, mirroring the original forward scheduleClip's anchor math
 * generalized with a signed `rate` divisor: ctxTime(t) = a.ctxTime +
 * (t - a.playheadMs) / (1000 * rate). Reads a pre-reversed copy of the
 * clip's PCM forward at Math.abs(rate) — never a negative playbackRate. */
function scheduleReverseClip(
  ctx: AudioContext,
  track: AudioTrack,
  clip: AudioClip,
  fromMs: number,
  a: Anchor,
  rate: number,
): void {
  if (fromMs <= clip.startMs) return; // already exhausted going backward
  const clipEndMs = clip.startMs + clip.durationMs;
  const R = Math.abs(rate);

  const buffer = getReversedAudioBuffer(clip.mediaId);
  if (!buffer) {
    if (!pendingDecode.has(clip.mediaId)) {
      pendingDecode.add(clip.mediaId);
      const blob = getMediaBlob(clip.mediaId);
      if (blob) {
        void decodeAudio(clip.mediaId, blob)
          .then(() => {
            if (lastMode === 'reverse') rescheduleActive();
          })
          .catch(() => {});
      }
    }
    return;
  }

  const gainNode = ctx.createGain();
  gainNode.gain.value = track.muted ? 0 : track.gain * clip.gain;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = R;
  src.connect(gainNode).connect(ctx.destination);

  let when: number;
  let offsetSec: number;
  let remainMs: number;
  if (fromMs >= clipEndMs) {
    // Clip lies entirely behind the current playhead; we'll reach its tail
    // (the entry point when moving backward) at a future ctx time.
    when = a.ctxTime + (clipEndMs - a.playheadMs) / (1000 * rate);
    offsetSec = reversedBufferOffsetSec(clip, clipEndMs, clip.sourceDurationMs);
    remainMs = clip.durationMs;
  } else {
    // Currently inside the clip's span.
    when = a.ctxTime + (fromMs - a.playheadMs) / (1000 * rate);
    offsetSec = reversedBufferOffsetSec(clip, fromMs, clip.sourceDurationMs);
    remainMs = fromMs - clip.startMs;
  }
  const startAt = Math.max(when, ctx.currentTime);
  src.start(startAt, offsetSec);
  src.stop(startAt + remainMs / 1000 / R);
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
  pendingDecode = new Set();
  const project = useDocumentStore.getState().project;
  for (const track of currentTracks(project)) {
    for (const clip of track.clips) scheduleReverseClip(ctx, track, clip, fromMs, a, rate);
  }
}

// --------------------------------------------------------------- dispatch

/** Reschedules whichever path is currently active from the live playhead —
 * used after an async decode/resume lands, when the mode may have changed. */
function rescheduleActive(): void {
  const state = useEditorStore.getState();
  if (lastMode === 'forward') syncForwardVoices(state.playheadMs);
  else if (lastMode === 'reverse') {
    anchor = { ctxTime: getAudioContext().currentTime, playheadMs: state.playheadMs };
    rescheduleReverse(state.playheadMs, state.playRate);
  }
}

function handleTick(fromMs: number): void {
  const state = useEditorStore.getState();
  const mode = modeFor(state);

  if (mode !== lastMode) {
    if (lastMode === 'forward') teardownForwardVoices();
    if (lastMode === 'reverse') stopAllReverse();
    lastMode = mode;
    lastPlayRate = state.playRate;
    if (mode === 'stopped') {
      anchor = null;
      return;
    }
    const ctx = getAudioContext();
    const go = () => {
      // Guard against the mode being toggled again during an async resume.
      if (modeFor() !== mode) return;
      anchor = { ctxTime: getAudioContext().currentTime, playheadMs: fromMs };
      pendingDecode = new Set();
      if (mode === 'forward') syncForwardVoices(fromMs);
      else rescheduleReverse(fromMs, state.playRate);
    };
    if (ctx.state === 'suspended') ctx.resume().then(go).catch(go);
    else go();
    return;
  }

  if (mode === 'stopped') return;

  if (mode === 'forward') {
    syncForwardVoices(fromMs);
    lastPlayRate = state.playRate;
    return;
  }

  // Reverse: a rate-magnitude/sign change mid-shuttle needs a fresh reschedule
  // (it's already baked into the currently-scheduled sources' stop() timing),
  // same as a seek beyond the drift tolerance.
  if (state.playRate !== lastPlayRate) {
    lastPlayRate = state.playRate;
    anchor = { ctxTime: getAudioContext().currentTime, playheadMs: fromMs };
    rescheduleReverse(fromMs, state.playRate);
    return;
  }
  if (anchor) {
    const expected =
      anchor.playheadMs + (getAudioContext().currentTime - anchor.ctxTime) * 1000 * state.playRate;
    if (Math.abs(fromMs - expected) > SEEK_EPS_MS) {
      anchor = { ctxTime: getAudioContext().currentTime, playheadMs: fromMs };
      rescheduleReverse(fromMs, state.playRate);
    }
  }
}

/**
 * Starts the audio engine's store subscriptions. Returns an unsubscribe that
 * stops playback and detaches listeners. Mount once (see useAudioPlayback).
 */
export function startAudioEngine(): () => void {
  let lastTracks = currentTracks(useDocumentStore.getState().project);

  const unsubEditor = useEditorStore.subscribe((state) => {
    handleTick(state.playheadMs);
  });

  // Reschedule when audio tracks/clips change during playback (add/move/trim).
  // immer keeps the audioTracks reference stable for unrelated document edits,
  // so this only fires on actual audio changes — no glitches from object edits.
  const unsubDoc = useDocumentStore.subscribe((state) => {
    const tracks = currentTracks(state.project);
    if (tracks === lastTracks) return;
    lastTracks = tracks;
    rescheduleActive();
  });

  return () => {
    unsubEditor();
    unsubDoc();
    teardownForwardVoices();
    stopAllReverse();
    anchor = null;
    lastMode = 'stopped';
    lastPlayRate = 0;
  };
}

/** Dev-only introspection for manual/Playwright verification (see devtools.ts). */
export function __debugAudioState() {
  return {
    mode: lastMode,
    forwardVoices: Array.from(forwardVoices.entries()).map(([key, v]) => ({
      key,
      currentTime: v.el.currentTime,
      playbackRate: v.el.playbackRate,
      preservesPitch: v.el.preservesPitch,
      paused: v.el.paused,
    })),
    reverseVoiceCount: activeReverse.length,
  };
}

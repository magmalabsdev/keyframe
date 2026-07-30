/**
 * Timeline transport and navigation commands.
 *
 * Free functions reading the stores via `getState()`, following the same idiom
 * as app/clipboard.ts — so the keymap, the timeline buttons, and any future
 * menu can all invoke exactly the same behavior.
 */
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { DEFAULT_FPS } from '../state/defaults';
import {
  frameMsFor,
  navKeyframeTimes,
  nextTimeAfter,
  prevTimeBefore,
  snapToFrame,
  stepFrame,
  stepMs,
} from '../animation/timeNav';
import type { Scene } from '../state/types';

/** Shuttle speeds stepped through by repeated J / L presses. */
export const SHUTTLE_LADDER = [-8, -4, -2, -1, 1, 2, 4, 8] as const;

/** How far either side of the playhead "play around current frame" covers. */
export const PLAY_AROUND_MS = 1000;

function scene(): Scene {
  return getActiveScene(useDocumentStore.getState().project);
}

export function activeFps(): number {
  return scene().settings.fps ?? DEFAULT_FPS;
}

/** Seeks to a time, snapped to the frame grid and clamped to the scene. */
function seek(ms: number): void {
  const s = scene();
  const snapped = snapToFrame(ms, s.settings.fps ?? DEFAULT_FPS);
  useEditorStore.getState().setPlayhead(Math.min(s.durationMs, Math.max(0, snapped)));
}

// ---------------------------------------------------------------- playback

/** L — play forward, or step up the shuttle ladder if already going forward. */
export function playForward(): void {
  const { playRate, setPlayRate } = useEditorStore.getState();
  setPlayRate(playRate <= 0 ? 1 : Math.min(8, playRate * 2));
}

/** J — play reverse, or step up the reverse shuttle ladder. */
export function playReverse(): void {
  const { playRate, setPlayRate } = useEditorStore.getState();
  setPlayRate(playRate >= 0 ? -1 : Math.max(-8, playRate * 2));
}

/** K — stop. */
export function stopPlayback(): void {
  useEditorStore.getState().stopPlayback();
}

/** Moves one notch along the shuttle ladder, skipping 0. */
function shuttle(dir: -1 | 1): void {
  const { playRate, setPlayRate } = useEditorStore.getState();
  const idx = SHUTTLE_LADDER.indexOf(playRate as (typeof SHUTTLE_LADDER)[number]);
  if (idx === -1) {
    setPlayRate(dir > 0 ? 1 : -1);
    return;
  }
  const next = Math.min(SHUTTLE_LADDER.length - 1, Math.max(0, idx + dir));
  setPlayRate(SHUTTLE_LADDER[next]);
}

export function shuttleFaster(): void {
  shuttle(1);
}

export function shuttleSlower(): void {
  shuttle(-1);
}

/** Space — play at 1x, or stop whatever rate is running. */
export function togglePlayPause(): void {
  const { playRate, setPlayRate } = useEditorStore.getState();
  setPlayRate(playRate !== 0 ? 0 : 1);
}

export function toggleLoop(): void {
  const { loop, setLoop } = useEditorStore.getState();
  setLoop(!loop);
}

/** Plays a second either side of the playhead, then stops. */
export function playAround(): void {
  const editor = useEditorStore.getState();
  const s = scene();
  const at = editor.playheadMs;
  editor.setPlayhead(Math.max(0, at - PLAY_AROUND_MS));
  // setPlayRate clears any stale stop point, so set ours after it.
  editor.setPlayRate(1);
  editor.setStopAt(Math.min(s.durationMs, at + PLAY_AROUND_MS));
}

/** Plays the marked range once, regardless of the loop setting. */
export function playInToOut(): void {
  const editor = useEditorStore.getState();
  const s = scene();
  editor.setPlayhead(editor.inMs ?? 0);
  editor.setPlayRate(1);
  editor.setStopAt(editor.outMs ?? s.durationMs);
}

// -------------------------------------------------------------- navigation

export function stepFrames(n: number): void {
  const s = scene();
  const fps = s.settings.fps ?? DEFAULT_FPS;
  const editor = useEditorStore.getState();
  let t = editor.playheadMs;
  const dir = n < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(n); i++) t = stepFrame(t, fps, dir, s.durationMs);
  editor.setPlayhead(t);
}

export function stepSeconds(n: number): void {
  const s = scene();
  const editor = useEditorStore.getState();
  editor.setPlayhead(stepMs(editor.playheadMs, n * 1000, s.durationMs));
}

export function goToStart(): void {
  useEditorStore.getState().setPlayhead(0);
}

export function goToEnd(): void {
  useEditorStore.getState().setPlayhead(scene().durationMs);
}

export function goToPrevKeyframe(): void {
  const editor = useEditorStore.getState();
  const times = navKeyframeTimes(scene(), editor.selectedIds);
  const t = prevTimeBefore(times, editor.playheadMs);
  if (t != null) seek(t);
}

export function goToNextKeyframe(): void {
  const editor = useEditorStore.getState();
  const times = navKeyframeTimes(scene(), editor.selectedIds);
  const t = nextTimeAfter(times, editor.playheadMs);
  if (t != null) seek(t);
}

function markerTimes(): number[] {
  return (scene().markers ?? []).map((m) => m.timeMs).sort((a, b) => a - b);
}

export function goToPrevMarker(): void {
  const t = prevTimeBefore(markerTimes(), useEditorStore.getState().playheadMs);
  if (t != null) seek(t);
}

export function goToNextMarker(): void {
  const t = nextTimeAfter(markerTimes(), useEditorStore.getState().playheadMs);
  if (t != null) seek(t);
}

// ------------------------------------------------------------------- marks

export function markIn(): void {
  const editor = useEditorStore.getState();
  editor.setInPoint(editor.playheadMs);
}

export function markOut(): void {
  const editor = useEditorStore.getState();
  editor.setOutPoint(editor.playheadMs);
}

export function clearIn(): void {
  useEditorStore.getState().setInPoint(null);
}

export function clearOut(): void {
  useEditorStore.getState().setOutPoint(null);
}

export function clearInOut(): void {
  useEditorStore.getState().setInOut(null, null);
}

/** X — marks the selection's lifetime (the union, for a multi-selection). */
export function markClip(): void {
  const editor = useEditorStore.getState();
  const selected = scene().objects.filter((o) => editor.selectedIds.includes(o.id));
  if (selected.length === 0) return;
  const start = Math.min(...selected.map((o) => o.lifetime.startMs));
  const end = Math.max(...selected.map((o) => o.lifetime.endMs));
  editor.setInOut(start, end);
}

export function goToIn(): void {
  const { inMs } = useEditorStore.getState();
  if (inMs != null) seek(inMs);
}

export function goToOut(): void {
  const { outMs } = useEditorStore.getState();
  if (outMs != null) seek(outMs);
}

export function hasIn(): boolean {
  return useEditorStore.getState().inMs != null;
}

export function hasOut(): boolean {
  return useEditorStore.getState().outMs != null;
}

// ----------------------------------------------------------------- markers

/** The marker within one frame of the playhead, if any. */
function markerAtPlayhead() {
  const { playheadMs } = useEditorStore.getState();
  const tolerance = frameMsFor(activeFps());
  return (scene().markers ?? []).find((m) => Math.abs(m.timeMs - playheadMs) <= tolerance);
}

export function addMarkerAtPlayhead(): void {
  useDocumentStore.getState().addMarker(useEditorStore.getState().playheadMs);
}

export function renameMarkerAtPlayhead(): void {
  const m = markerAtPlayhead();
  if (!m) return;
  const name = window.prompt('Marker name', m.name);
  if (name != null) useDocumentStore.getState().renameMarker(m.id, name);
}

export function deleteMarkerAtPlayhead(): void {
  const m = markerAtPlayhead();
  if (m) useDocumentStore.getState().removeMarker(m.id);
}

export function hasSelection(): boolean {
  return useEditorStore.getState().selectedIds.length > 0;
}

// ------------------------------------------------------------- clip editing

/** Whether a single selected object's span, or any object/audio clip's span
 * (batch case), currently covers the playhead — mirrors splitAtPlayhead's own
 * targeting logic in read-only form, for the keymap `when()` gate. */
export function hasSplitTarget(): boolean {
  const editor = useEditorStore.getState();
  const s = scene();
  const t = editor.playheadMs;
  const isLeaf = (id: string) => !s.objects.some((o) => o.parentId === id);
  if (editor.selectedIds.length === 1) {
    const obj = s.objects.find((o) => o.id === editor.selectedIds[0]);
    return !!obj && obj.lifetime.startMs < t && t < obj.lifetime.endMs && isLeaf(obj.id);
  }
  const anyObject = s.objects.some(
    (o) => o.lifetime.startMs < t && t < o.lifetime.endMs && isLeaf(o.id),
  );
  const anyClip = (s.audioTracks ?? []).some((tr) =>
    tr.clips.some((c) => c.startMs < t && t < c.startMs + c.durationMs),
  );
  return anyObject || anyClip;
}

export function splitAtPlayhead(): void {
  const editor = useEditorStore.getState();
  useDocumentStore.getState().splitAtPlayhead(editor.playheadMs, editor.selectedIds);
}

/** Whether the single selected object's span currently covers the playhead
 * (audio clips have no selection concept yet, so ripple-trim is object-only). */
export function hasRippleTrimTarget(): boolean {
  const editor = useEditorStore.getState();
  if (editor.selectedIds.length !== 1) return false;
  const obj = scene().objects.find((o) => o.id === editor.selectedIds[0]);
  const t = editor.playheadMs;
  return !!obj && t > obj.lifetime.startMs && t < obj.lifetime.endMs;
}

export function rippleTrimInToPlayhead(): void {
  const editor = useEditorStore.getState();
  if (editor.selectedIds.length !== 1) return;
  useDocumentStore.getState().rippleTrimObjectToPlayhead(editor.selectedIds[0], editor.playheadMs, 'in');
}

export function rippleTrimOutToPlayhead(): void {
  const editor = useEditorStore.getState();
  if (editor.selectedIds.length !== 1) return;
  useDocumentStore.getState().rippleTrimObjectToPlayhead(editor.selectedIds[0], editor.playheadMs, 'out');
}

/** Duplicates the single selected leaf object adjacent in time. */
export function duplicateClipAdjacent(): void {
  const editor = useEditorStore.getState();
  if (editor.selectedIds.length !== 1) return;
  useDocumentStore.getState().duplicateObjectAdjacent(editor.selectedIds[0]);
}

// -------------------------------------------------------------------- misc

export function toggleSnapping(): void {
  const { snapEnabled, setSnapEnabled } = useEditorStore.getState();
  setSnapEnabled(!snapEnabled);
}

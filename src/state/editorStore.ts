import { create } from 'zustand';
import type { Point2 } from './types';
import type { TimelineSnapModes } from '../animation/timeNav';

export type Tool = 'select' | 'move' | 'scale' | 'rotate' | 'place' | 'surface';
export type SaveStatus = 'idle' | 'saving' | 'saved';

/** A background operation (import, texture load, etc.) shown in the top-center HUD. */
export interface BackgroundTask {
  id: string;
  label: string;
  /** 0..1, or null while indeterminate. */
  progress: number | null;
}

/**
 * Transient editor state (selection, active tool, playhead). This is deliberately
 * separate from the document store so it is never serialized and never part of
 * undo/redo history.
 */
export interface EditorState {
  selectedIds: string[];
  activeTool: Tool;
  playheadMs: number;
  playing: boolean;
  /**
   * Signed playback rate: negative reverses, 0 is stopped, 1 is realtime.
   * Invariant maintained by the setters: `playing === (playRate !== 0)`.
   */
  playRate: number;
  /** Wrap around at the end of the play range instead of stopping. Persisted. */
  loop: boolean;
  /** Play-range in point, or null for the start of the scene. */
  inMs: number | null;
  /** Play-range out point, or null for the end of the scene. */
  outMs: number | null;
  /**
   * One-shot stop point, consumed on the next stop. Backs "play around" and
   * "play in to out", which must run once even while looping is on.
   */
  stopAtMs: number | null;
  /** Whether the keyboard-shortcut cheat sheet is open. */
  helpOpen: boolean;
  /** Object currently being dragged by a gizmo (playback won't override it). */
  draggingId: string | null;
  saveStatus: SaveStatus;
  /** 0..1 while exporting video, null otherwise. */
  exportProgress: number | null;
  /** True while previewing a clean render (build plate/gizmo/overlays hidden). */
  renderPreview: boolean;
  /** Whether face-to-face object snapping is active while moving. */
  snapEnabled: boolean;
  /**
   * Independently toggleable timeline drag-snap modes ("none" = all false).
   * When more than one is active, whichever candidate is nearest wins.
   * Persisted.
   */
  timelineSnap: TimelineSnapModes;
  /**
   * Whether the Move/Rotate gizmo handles (and the inspector's numeric
   * Position/Rotation fields) align to the selected object's own axes
   * ('relative') or world axes ('absolute'). Scale is unaffected either way —
   * three.js's TransformControls always scales in local space.
   */
  transformSpace: 'relative' | 'absolute';
  /** Object whose center of rotation is being edited (shows a pivot handle). */
  corEditId: string | null;
  /** Surface whose polygon vertices are being edited (shows vertex handles). */
  surfaceEditId: string | null;
  /**
   * Live polygon outline during a vertex drag. Transient by design: the
   * document store would otherwise record one undo entry per pointermove.
   */
  surfacePreviewPoints: Point2[] | null;
  /** Background operations (import, texture load, etc.) shown in the top-center HUD. */
  backgroundTasks: BackgroundTask[];
  /** STEP tessellation quality 0 (coarse/fast) .. 1 (fine/slow). Persisted. */
  importQuality: number;
  /** Timeline horizontal zoom: screen pixels per millisecond. Viewport state, not persisted. */
  timelinePxPerMs: number;
  /** Left edge of the visible timeline window, in ms. Viewport state, not persisted. */
  timelineViewStartMs: number;
  /** Multiplier on the base row height (Shift+wheel on the timeline). Persisted. */
  timelineRowScale: number;

  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  setTool: (tool: Tool) => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  /** Set the signed rate; 0 stops. Keeps `playing` in sync. */
  setPlayRate: (rate: number) => void;
  /** Stop playback and clear any one-shot stop point. */
  stopPlayback: () => void;
  setLoop: (on: boolean) => void;
  setInPoint: (ms: number | null) => void;
  setOutPoint: (ms: number | null) => void;
  setInOut: (inMs: number | null, outMs: number | null) => void;
  setStopAt: (ms: number | null) => void;
  setHelpOpen: (open: boolean) => void;
  setDraggingId: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setExportProgress: (progress: number | null) => void;
  setRenderPreview: (on: boolean) => void;
  setSnapEnabled: (on: boolean) => void;
  setTimelineSnap: (patch: Partial<TimelineSnapModes>) => void;
  setTransformSpace: (space: 'relative' | 'absolute') => void;
  setCorEditId: (id: string | null) => void;
  setSurfaceEditId: (id: string | null) => void;
  setSurfacePreviewPoints: (points: Point2[] | null) => void;
  startBackgroundTask: (id: string, label: string) => void;
  setBackgroundTaskProgress: (id: string, progress: number | null, label?: string) => void;
  endBackgroundTask: (id: string) => void;
  setImportQuality: (q: number) => void;
  setTimelineZoom: (pxPerMs: number, viewStartMs: number) => void;
  setTimelineRowScale: (scale: number) => void;
}

const IMPORT_QUALITY_KEY = 'keyframe:importQuality';
function loadImportQuality(): number {
  try {
    const v = Number(localStorage.getItem(IMPORT_QUALITY_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.5;
  } catch {
    return 0.5;
  }
}

const LOOP_KEY = 'keyframe:loop';
function loadLoop(): boolean {
  try {
    return localStorage.getItem(LOOP_KEY) === '1';
  } catch {
    return false;
  }
}

const TIMELINE_SNAP_KEY = 'keyframe:timelineSnap';
function loadTimelineSnap(): TimelineSnapModes {
  try {
    const p = JSON.parse(localStorage.getItem(TIMELINE_SNAP_KEY) ?? '{}');
    return { second: !!p.second, frame: !!p.frame, clip: !!p.clip };
  } catch {
    return { second: false, frame: false, clip: false };
  }
}

export const MIN_PX_PER_MS = 0.01;
export const MAX_PX_PER_MS = 5;
export const ROW_SCALE_MIN = 0.5;
export const ROW_SCALE_MAX = 3;

const ROW_SCALE_KEY = 'keyframe:timelineRowScale';
function loadRowScale(): number {
  try {
    const v = Number(localStorage.getItem(ROW_SCALE_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(ROW_SCALE_MAX, Math.max(ROW_SCALE_MIN, v)) : 1;
  } catch {
    return 1;
  }
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedIds: [],
  activeTool: 'move',
  playheadMs: 0,
  playing: false,
  playRate: 0,
  loop: loadLoop(),
  inMs: null,
  outMs: null,
  stopAtMs: null,
  helpOpen: false,
  draggingId: null,
  saveStatus: 'idle',
  exportProgress: null,
  renderPreview: false,
  snapEnabled: true,
  timelineSnap: loadTimelineSnap(),
  transformSpace: 'absolute',
  corEditId: null,
  surfaceEditId: null,
  surfacePreviewPoints: null,
  backgroundTasks: [],
  importQuality: loadImportQuality(),
  timelinePxPerMs: 0.05,
  timelineViewStartMs: 0,
  timelineRowScale: loadRowScale(),

  setSelection: (ids) => set({ selectedIds: ids }),
  toggleSelection: (id, additive) =>
    set((s) => {
      if (!additive) return { selectedIds: [id] };
      return s.selectedIds.includes(id)
        ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
        : { selectedIds: [...s.selectedIds, id] };
    }),
  clearSelection: () => set({ selectedIds: [] }),
  setTool: (tool) => set({ activeTool: tool }),
  setPlayhead: (ms) => set({ playheadMs: Math.max(0, ms) }),
  // Pausing always exits a clean-render preview. `playRate` is kept in lockstep
  // so every consumer of `playing` (animation loop, audio, transport UI) stays
  // correct without having to know about shuttling: resuming from a stop plays
  // at 1x, while resuming mid-shuttle keeps the rate you were shuttling at.
  // Both clear any one-shot stop point: it belongs to the play-around / play-in-
  // to-out command that set it, so a fresh play command must not inherit it.
  // Those two call setStopAt() right after setting the rate.
  setPlaying: (playing) =>
    set((s) =>
      playing
        ? { playing: true, playRate: s.playRate !== 0 ? s.playRate : 1, stopAtMs: null }
        : { playing: false, playRate: 0, stopAtMs: null, renderPreview: false },
    ),
  setPlayRate: (rate) =>
    set(
      rate !== 0
        ? { playRate: rate, playing: true, stopAtMs: null }
        : { playRate: 0, playing: false, stopAtMs: null, renderPreview: false },
    ),
  stopPlayback: () =>
    set({ playing: false, playRate: 0, stopAtMs: null, renderPreview: false }),
  setLoop: (loop) => {
    set({ loop });
    try {
      localStorage.setItem(LOOP_KEY, loop ? '1' : '0');
    } catch {
      // Private browsing / storage disabled: the toggle still works this session.
    }
  },
  // Marking either end past the other clears the stale one — the newer mark wins,
  // which keeps the range from ever being inverted.
  setInPoint: (inMs) =>
    set((s) => ({ inMs, outMs: inMs != null && s.outMs != null && inMs >= s.outMs ? null : s.outMs })),
  setOutPoint: (outMs) =>
    set((s) => ({ outMs, inMs: outMs != null && s.inMs != null && outMs <= s.inMs ? null : s.inMs })),
  setInOut: (inMs, outMs) => set({ inMs, outMs }),
  setStopAt: (stopAtMs) => set({ stopAtMs }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setDraggingId: (id) => set({ draggingId: id }),
  setRenderPreview: (renderPreview) => set({ renderPreview }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setTimelineSnap: (patch) =>
    set((s) => {
      const timelineSnap = { ...s.timelineSnap, ...patch };
      try {
        localStorage.setItem(TIMELINE_SNAP_KEY, JSON.stringify(timelineSnap));
      } catch {
        // Private browsing / storage disabled: the toggle still works this session.
      }
      return { timelineSnap };
    }),
  setTransformSpace: (transformSpace) => set({ transformSpace }),
  setCorEditId: (corEditId) => set({ corEditId }),
  setSurfaceEditId: (surfaceEditId) => set({ surfaceEditId, surfacePreviewPoints: null }),
  setSurfacePreviewPoints: (surfacePreviewPoints) => set({ surfacePreviewPoints }),
  startBackgroundTask: (id, label) =>
    set((s) => ({
      backgroundTasks: [
        ...s.backgroundTasks.filter((t) => t.id !== id),
        { id, label, progress: null },
      ],
    })),
  setBackgroundTaskProgress: (id, progress, label) =>
    set((s) => ({
      backgroundTasks: s.backgroundTasks.map((t) =>
        t.id === id ? { ...t, progress, ...(label !== undefined ? { label } : {}) } : t,
      ),
    })),
  endBackgroundTask: (id) =>
    set((s) => ({ backgroundTasks: s.backgroundTasks.filter((t) => t.id !== id) })),
  setImportQuality: (q) => {
    const v = Math.max(0, Math.min(1, q));
    try {
      localStorage.setItem(IMPORT_QUALITY_KEY, String(v));
    } catch {
      /* ignore */
    }
    set({ importQuality: v });
  },
  setTimelineZoom: (pxPerMs, viewStartMs) =>
    set({
      timelinePxPerMs: Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, pxPerMs)),
      timelineViewStartMs: Math.max(0, viewStartMs),
    }),
  setTimelineRowScale: (scale) => {
    const v = Math.min(ROW_SCALE_MAX, Math.max(ROW_SCALE_MIN, scale));
    try {
      localStorage.setItem(ROW_SCALE_KEY, String(v));
    } catch {
      // Private browsing / storage disabled: the toggle still works this session.
    }
    set({ timelineRowScale: v });
  },
}));

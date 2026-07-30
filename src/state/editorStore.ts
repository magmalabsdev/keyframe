import { create } from 'zustand';

export type Tool = 'select' | 'move' | 'scale' | 'rotate' | 'place';
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
  /** Object currently being dragged by a gizmo (playback won't override it). */
  draggingId: string | null;
  saveStatus: SaveStatus;
  /** 0..1 while exporting video, null otherwise. */
  exportProgress: number | null;
  /** True while previewing a clean render (build plate/gizmo/overlays hidden). */
  renderPreview: boolean;
  /** Whether face-to-face object snapping is active while moving. */
  snapEnabled: boolean;
  /** Object whose center of rotation is being edited (shows a pivot handle). */
  corEditId: string | null;
  /** Background operations (import, texture load, etc.) shown in the top-center HUD. */
  backgroundTasks: BackgroundTask[];
  /** STEP tessellation quality 0 (coarse/fast) .. 1 (fine/slow). Persisted. */
  importQuality: number;

  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  setTool: (tool: Tool) => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setDraggingId: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setExportProgress: (progress: number | null) => void;
  setRenderPreview: (on: boolean) => void;
  setSnapEnabled: (on: boolean) => void;
  setCorEditId: (id: string | null) => void;
  startBackgroundTask: (id: string, label: string) => void;
  setBackgroundTaskProgress: (id: string, progress: number | null) => void;
  endBackgroundTask: (id: string) => void;
  setImportQuality: (q: number) => void;
}

const IMPORT_QUALITY_KEY = 'keyframe:importQuality';
function loadImportQuality(): number {
  const v = Number(localStorage.getItem(IMPORT_QUALITY_KEY));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.5;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedIds: [],
  activeTool: 'move',
  playheadMs: 0,
  playing: false,
  draggingId: null,
  saveStatus: 'idle',
  exportProgress: null,
  renderPreview: false,
  snapEnabled: true,
  corEditId: null,
  backgroundTasks: [],
  importQuality: loadImportQuality(),

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
  // Pausing always exits a clean-render preview.
  setPlaying: (playing) =>
    set(playing ? { playing } : { playing: false, renderPreview: false }),
  setDraggingId: (id) => set({ draggingId: id }),
  setRenderPreview: (renderPreview) => set({ renderPreview }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setCorEditId: (corEditId) => set({ corEditId }),
  startBackgroundTask: (id, label) =>
    set((s) => ({
      backgroundTasks: [
        ...s.backgroundTasks.filter((t) => t.id !== id),
        { id, label, progress: null },
      ],
    })),
  setBackgroundTaskProgress: (id, progress) =>
    set((s) => ({
      backgroundTasks: s.backgroundTasks.map((t) =>
        t.id === id ? { ...t, progress } : t,
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
}));

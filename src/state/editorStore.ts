import { create } from 'zustand';

export type Tool = 'select' | 'move' | 'scale' | 'rotate';
export type SaveStatus = 'idle' | 'saving' | 'saved';

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

  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  setTool: (tool: Tool) => void;
  setPlayhead: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setDraggingId: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setExportProgress: (progress: number | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedIds: [],
  activeTool: 'move',
  playheadMs: 0,
  playing: false,
  draggingId: null,
  saveStatus: 'idle',
  exportProgress: null,

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
  setPlaying: (playing) => set({ playing }),
  setDraggingId: (id) => set({ draggingId: id }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
}));

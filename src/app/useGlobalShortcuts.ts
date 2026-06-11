import { useEffect } from 'react';
import { undo, redo } from '../state/documentStore';
import { useEditorStore, type Tool } from '../state/editorStore';
import { keyframeSelection } from '../animation/transformEdit';
import { saveNow } from '../io/persistence';
import { groupSelection, ungroupSelection } from '../scene/grouping';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  selectAll,
} from './clipboard';

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  );
}

const TOOL_KEYS: Record<string, Tool> = {
  '1': 'select',
  '2': 'move',
  '3': 'scale',
  '4': 'rotate',
  '5': 'place',
};

/** Registers the global keyboard shortcuts described in the spec. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          redo();
          return;
        }
        if (k === 's') {
          e.preventDefault();
          void saveNow();
          return;
        }
        if (k === 'g') {
          e.preventDefault();
          if (e.shiftKey) ungroupSelection();
          else groupSelection();
          return;
        }
        // Let native editing shortcuts work inside text fields.
        if (isTyping()) return;
        if (k === 'c') {
          e.preventDefault();
          copySelection();
        } else if (k === 'x') {
          e.preventDefault();
          cutSelection();
        } else if (k === 'v') {
          e.preventDefault();
          pasteClipboard();
        } else if (k === 'd') {
          e.preventDefault();
          duplicateSelection();
        } else if (k === 'a') {
          e.preventDefault();
          selectAll();
        }
        return;
      }

      if (isTyping()) return;

      if (TOOL_KEYS[e.key]) {
        useEditorStore.getState().setTool(TOOL_KEYS[e.key]);
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        keyframeSelection();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        const { playing, setPlaying } = useEditorStore.getState();
        setPlaying(!playing);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        useEditorStore.getState().clearSelection();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

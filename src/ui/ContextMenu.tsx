import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getActiveScene, redo, undo, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { groupSelection, ungroupSelection } from '../scene/grouping';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  hasClipboard,
  pasteClipboard,
  selectAll,
} from '../app/clipboard';
import { chordFor } from '../app/keymap';
import { useContextMenu, type MenuItem } from './contextMenuStore';
import styles from './ContextMenu.module.css';

export { useContextMenu, type MenuItem } from './contextMenuStore';

/** Standard edit menu wired to the existing clipboard / grouping / history ops. */
export function buildSelectionMenu(): MenuItem[] {
  const sel = useEditorStore.getState().selectedIds;
  const objects = getActiveScene(useDocumentStore.getState().project).objects;
  const selObjs = objects.filter((o) => sel.includes(o.id));
  const hasSel = sel.length > 0;
  const temporal = useDocumentStore.temporal.getState();

  return [
    { label: 'Cut', shortcut: chordFor('edit.cut'), disabled: !hasSel, onClick: cutSelection },
    { label: 'Copy', shortcut: chordFor('edit.copy'), disabled: !hasSel, onClick: copySelection },
    { label: 'Paste', shortcut: chordFor('edit.paste'), disabled: !hasClipboard(), onClick: pasteClipboard },
    {
      label: 'Duplicate',
      shortcut: chordFor('edit.duplicate'),
      disabled: !hasSel,
      onClick: duplicateSelection,
    },
    { label: 'Delete', shortcut: chordFor('edit.delete2'), disabled: !hasSel, onClick: deleteSelection },
    { label: '', separator: true },
    {
      label: 'Group',
      shortcut: chordFor('edit.group'),
      disabled: selObjs.length < 2,
      onClick: groupSelection,
    },
    {
      label: 'Ungroup',
      shortcut: chordFor('edit.ungroup'),
      disabled: !selObjs.some((o) => o.type === 'group'),
      onClick: ungroupSelection,
    },
    { label: 'Select all', shortcut: chordFor('edit.selectAll'), onClick: selectAll },
    { label: '', separator: true },
    {
      label: 'Undo',
      shortcut: chordFor('edit.undo'),
      disabled: temporal.pastStates.length === 0,
      onClick: undo,
    },
    {
      label: 'Redo',
      shortcut: chordFor('edit.redo'),
      disabled: temporal.futureStates.length === 0,
      onClick: redo,
    },
  ];
}

/** Opens the standard edit menu at a screen position. */
export function openSelectionMenu(x: number, y: number): void {
  useContextMenu.getState().openMenu(x, y, buildSelectionMenu());
}

/** Singleton menu surface; mount once near the app root. */
export function ContextMenu() {
  const { open, x, y, items, closeMenu } = useContextMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 240;
    setPos({
      x: Math.min(x, window.innerWidth - w - 8),
      y: Math.min(y, window.innerHeight - h - 8),
    });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('wheel', closeMenu, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('wheel', closeMenu);
    };
  }, [open, closeMenu]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onPointerDown={closeMenu} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        className={styles.menu}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className={styles.separator} />
          ) : (
            <button
              key={i}
              className={styles.item}
              disabled={it.disabled}
              onClick={() => {
                it.onClick?.();
                closeMenu();
              }}
            >
              <span>{it.label}</span>
              {it.shortcut && <span className={styles.shortcut}>{it.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

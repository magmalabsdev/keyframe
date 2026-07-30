import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
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
import styles from './ContextMenu.module.css';

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
  shortcut?: string;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  closeMenu: () => void;
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  closeMenu: () => set({ open: false, items: [] }),
}));

/** Standard edit menu wired to the existing clipboard / grouping / history ops. */
export function buildSelectionMenu(): MenuItem[] {
  const sel = useEditorStore.getState().selectedIds;
  const objects = getActiveScene(useDocumentStore.getState().project).objects;
  const selObjs = objects.filter((o) => sel.includes(o.id));
  const hasSel = sel.length > 0;
  const temporal = useDocumentStore.temporal.getState();

  return [
    { label: 'Cut', shortcut: '⌘X', disabled: !hasSel, onClick: cutSelection },
    { label: 'Copy', shortcut: '⌘C', disabled: !hasSel, onClick: copySelection },
    { label: 'Paste', shortcut: '⌘V', disabled: !hasClipboard(), onClick: pasteClipboard },
    {
      label: 'Duplicate',
      shortcut: '⌘D',
      disabled: !hasSel,
      onClick: duplicateSelection,
    },
    { label: 'Delete', shortcut: '⌫', disabled: !hasSel, onClick: deleteSelection },
    { label: '', separator: true },
    {
      label: 'Group',
      shortcut: '⌘G',
      disabled: selObjs.length < 2,
      onClick: groupSelection,
    },
    {
      label: 'Ungroup',
      shortcut: '⌘⇧G',
      disabled: !selObjs.some((o) => o.type === 'group'),
      onClick: ungroupSelection,
    },
    { label: 'Select all', shortcut: '⌘A', onClick: selectAll },
    { label: '', separator: true },
    {
      label: 'Undo',
      shortcut: '⌘Z',
      disabled: temporal.pastStates.length === 0,
      onClick: undo,
    },
    {
      label: 'Redo',
      shortcut: '⌘⇧Z',
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

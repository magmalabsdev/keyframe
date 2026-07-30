/**
 * Context-menu open state, split out from the component so modules that only
 * need to know whether a menu is open (the keymap's Escape guard) can import it
 * without pulling in the menu's own dependencies — which would be a cycle,
 * since the menu labels its items from the keymap.
 */
import { create } from 'zustand';

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

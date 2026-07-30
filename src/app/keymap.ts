/**
 * The single source of truth for keyboard shortcuts: this table both binds the
 * keys (app/useGlobalShortcuts.ts) and renders the cheat sheet
 * (ui/ShortcutHelp.tsx), so the two can never drift apart.
 *
 * Bindings match on `KeyboardEvent.code` (the physical key) rather than `.key`,
 * because `.key` is rewritten by modifiers: Shift turns 'l' into 'L' and '/'
 * into '?', and on macOS Option turns 'i' into a dead 'ˆ' and 'o' into 'ø'.
 * Matching on `code` is what lets ⌥I and ⇧/ be expressed at all. The legacy
 * ⌘+letter bindings keep matching on `.key` so undo/copy still land correctly
 * on non-QWERTY layouts, where the letters sit on different physical keys.
 */
import { undo, redo } from '../state/documentStore';
import { useEditorStore, type Tool } from '../state/editorStore';
import { keyframeSelection } from '../animation/transformEdit';
import { saveNow } from '../io/persistence';
import { groupSelection, ungroupSelection } from '../scene/grouping';
import { useContextMenu } from '../ui/contextMenuStore';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  selectAll,
} from './clipboard';
import * as T from './transport';

export type ShortcutGroup =
  | 'Playback'
  | 'Navigation'
  | 'Marks'
  | 'Markers'
  | 'Keyframes'
  | 'Edit'
  | 'Tools'
  | 'General';

export interface Binding {
  id: string;
  /** Physical key (KeyboardEvent.code). Preferred: survives Shift and Option. */
  code?: string;
  /** Logical key, matched case-insensitively. Only for the ⌘+letter bindings. */
  key?: string;
  /** ⌘ on macOS, Ctrl elsewhere. Undefined means the modifier must be absent. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: string;
  group: ShortcutGroup;
  run: () => void;
  /** When present and false, the binding is inert and hidden from the sheet. */
  when?: () => boolean;
  /** Fires even while a text field has focus (undo/redo/save/group). */
  allowWhileTyping?: boolean;
  /** Fires on OS key-repeat. Off by default. */
  repeatable?: boolean;
  /** Kept out of the cheat sheet (aliases). */
  hidden?: boolean;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

const TOOL_KEYS: [string, Tool][] = [
  ['Digit1', 'select'],
  ['Digit2', 'move'],
  ['Digit3', 'scale'],
  ['Digit4', 'rotate'],
  ['Digit5', 'place'],
  ['Digit6', 'surface'],
];

const editor = () => useEditorStore.getState();

export const KEYMAP: Binding[] = [
  // ------------------------------------------------------------- Playback
  {
    id: 'play.forward',
    code: 'KeyL',
    label: 'Play forward / faster (1× → 8×)',
    group: 'Playback',
    run: T.playForward,
  },
  {
    id: 'play.reverse',
    code: 'KeyJ',
    label: 'Play reverse / faster',
    group: 'Playback',
    run: T.playReverse,
  },
  { id: 'play.stop', code: 'KeyK', label: 'Stop', group: 'Playback', run: T.stopPlayback },
  {
    id: 'play.faster',
    code: 'KeyL',
    shift: true,
    label: 'Shuttle faster forward',
    group: 'Playback',
    run: T.shuttleFaster,
  },
  {
    id: 'play.slower',
    code: 'KeyJ',
    shift: true,
    label: 'Shuttle faster reverse',
    group: 'Playback',
    run: T.shuttleSlower,
  },
  {
    id: 'play.toggle',
    code: 'Space',
    label: 'Play / pause',
    group: 'Playback',
    run: T.togglePlayPause,
  },
  {
    id: 'play.loop',
    code: 'Slash',
    mod: true,
    label: 'Toggle loop playback',
    group: 'Playback',
    run: T.toggleLoop,
  },
  {
    id: 'play.around',
    code: 'Slash',
    label: 'Play around current frame',
    group: 'Playback',
    run: T.playAround,
  },
  {
    id: 'play.inToOut',
    code: 'Slash',
    alt: true,
    label: 'Play in to out',
    group: 'Playback',
    run: T.playInToOut,
  },

  // ----------------------------------------------------------- Navigation
  {
    id: 'nav.frameBack',
    code: 'ArrowLeft',
    label: 'Step back one frame',
    group: 'Navigation',
    repeatable: true,
    run: () => T.stepFrames(-1),
  },
  {
    id: 'nav.frameFwd',
    code: 'ArrowRight',
    label: 'Step forward one frame',
    group: 'Navigation',
    repeatable: true,
    run: () => T.stepFrames(1),
  },
  {
    id: 'nav.secBack',
    code: 'ArrowLeft',
    shift: true,
    label: 'Step back one second',
    group: 'Navigation',
    repeatable: true,
    run: () => T.stepSeconds(-1),
  },
  {
    id: 'nav.secFwd',
    code: 'ArrowRight',
    shift: true,
    label: 'Step forward one second',
    group: 'Navigation',
    repeatable: true,
    run: () => T.stepSeconds(1),
  },
  {
    id: 'nav.prevKey',
    code: 'ArrowUp',
    label: 'Previous keyframe',
    group: 'Navigation',
    repeatable: true,
    run: T.goToPrevKeyframe,
  },
  {
    id: 'nav.nextKey',
    code: 'ArrowDown',
    label: 'Next keyframe',
    group: 'Navigation',
    repeatable: true,
    run: T.goToNextKeyframe,
  },
  {
    id: 'nav.prevKey2',
    code: 'BracketLeft',
    label: 'Previous keyframe',
    group: 'Navigation',
    repeatable: true,
    hidden: true,
    run: T.goToPrevKeyframe,
  },
  {
    id: 'nav.nextKey2',
    code: 'BracketRight',
    label: 'Next keyframe',
    group: 'Navigation',
    repeatable: true,
    hidden: true,
    run: T.goToNextKeyframe,
  },
  {
    id: 'nav.start',
    code: 'Home',
    label: 'Go to start',
    group: 'Navigation',
    run: T.goToStart,
  },
  { id: 'nav.end', code: 'End', label: 'Go to end', group: 'Navigation', run: T.goToEnd },
  {
    id: 'nav.first',
    code: 'Semicolon',
    label: 'Go to first frame',
    group: 'Navigation',
    run: T.goToStart,
  },
  {
    id: 'nav.last',
    code: 'Quote',
    label: 'Go to last frame',
    group: 'Navigation',
    run: T.goToEnd,
  },

  // ---------------------------------------------------------------- Marks
  { id: 'mark.in', code: 'KeyI', label: 'Mark in', group: 'Marks', run: T.markIn },
  { id: 'mark.out', code: 'KeyO', label: 'Mark out', group: 'Marks', run: T.markOut },
  {
    id: 'mark.clearIn',
    code: 'KeyI',
    alt: true,
    label: 'Clear in point',
    group: 'Marks',
    run: T.clearIn,
  },
  {
    id: 'mark.clearOut',
    code: 'KeyO',
    alt: true,
    label: 'Clear out point',
    group: 'Marks',
    run: T.clearOut,
  },
  {
    id: 'mark.clearBoth',
    code: 'KeyX',
    alt: true,
    label: 'Clear in and out',
    group: 'Marks',
    run: T.clearInOut,
  },
  {
    id: 'mark.clip',
    code: 'KeyX',
    label: "Mark the selection's lifetime",
    group: 'Marks',
    when: T.hasSelection,
    run: T.markClip,
  },
  {
    id: 'mark.gotoIn',
    code: 'KeyI',
    shift: true,
    label: 'Go to in point',
    group: 'Marks',
    when: T.hasIn,
    run: T.goToIn,
  },
  {
    id: 'mark.gotoOut',
    code: 'KeyO',
    shift: true,
    label: 'Go to out point',
    group: 'Marks',
    when: T.hasOut,
    run: T.goToOut,
  },

  // -------------------------------------------------------------- Markers
  {
    id: 'marker.add',
    code: 'KeyM',
    label: 'Add marker',
    group: 'Markers',
    run: T.addMarkerAtPlayhead,
  },
  {
    id: 'marker.rename',
    code: 'KeyM',
    shift: true,
    label: 'Rename marker at playhead',
    group: 'Markers',
    run: T.renameMarkerAtPlayhead,
  },
  {
    id: 'marker.delete',
    code: 'KeyM',
    alt: true,
    label: 'Delete marker at playhead',
    group: 'Markers',
    run: T.deleteMarkerAtPlayhead,
  },
  {
    id: 'marker.prev',
    code: 'ArrowUp',
    shift: true,
    label: 'Previous marker',
    group: 'Markers',
    repeatable: true,
    run: T.goToPrevMarker,
  },
  {
    id: 'marker.next',
    code: 'ArrowDown',
    shift: true,
    label: 'Next marker',
    group: 'Markers',
    repeatable: true,
    run: T.goToNextMarker,
  },

  // ------------------------------------------------------------ Keyframes
  {
    id: 'key.add',
    code: 'BracketLeft',
    mod: true,
    label: 'Add keyframe at playhead',
    group: 'Keyframes',
    run: keyframeSelection,
  },

  // ----------------------------------------------------------------- Edit
  {
    id: 'edit.undo',
    key: 'z',
    mod: true,
    label: 'Undo',
    group: 'Edit',
    allowWhileTyping: true,
    run: undo,
  },
  {
    id: 'edit.redo',
    key: 'z',
    mod: true,
    shift: true,
    label: 'Redo',
    group: 'Edit',
    allowWhileTyping: true,
    run: redo,
  },
  {
    id: 'edit.redo2',
    key: 'y',
    mod: true,
    label: 'Redo',
    group: 'Edit',
    allowWhileTyping: true,
    hidden: true,
    run: redo,
  },
  { id: 'edit.cut', key: 'x', mod: true, label: 'Cut', group: 'Edit', run: cutSelection },
  { id: 'edit.copy', key: 'c', mod: true, label: 'Copy', group: 'Edit', run: copySelection },
  { id: 'edit.paste', key: 'v', mod: true, label: 'Paste', group: 'Edit', run: pasteClipboard },
  {
    id: 'edit.duplicate',
    key: 'd',
    mod: true,
    label: 'Duplicate',
    group: 'Edit',
    run: duplicateSelection,
  },
  {
    id: 'edit.splitAtPlayhead',
    key: 'b',
    mod: true,
    label: 'Split at playhead',
    group: 'Edit',
    when: T.hasSplitTarget,
    run: T.splitAtPlayhead,
  },
  {
    id: 'edit.rippleTrimIn',
    code: 'KeyQ',
    label: 'Ripple-trim in to playhead',
    group: 'Edit',
    when: T.hasRippleTrimTarget,
    run: T.rippleTrimInToPlayhead,
  },
  {
    id: 'edit.rippleTrimOut',
    code: 'KeyW',
    label: 'Ripple-trim out to playhead',
    group: 'Edit',
    when: T.hasRippleTrimTarget,
    run: T.rippleTrimOutToPlayhead,
  },
  {
    id: 'edit.duplicateClip',
    key: 'd',
    mod: true,
    shift: true,
    label: 'Duplicate clip (adjacent in time)',
    group: 'Edit',
    when: T.hasSelection,
    run: T.duplicateClipAdjacent,
  },
  { id: 'edit.selectAll', key: 'a', mod: true, label: 'Select all', group: 'Edit', run: selectAll },
  {
    id: 'edit.group',
    key: 'g',
    mod: true,
    label: 'Group',
    group: 'Edit',
    allowWhileTyping: true,
    run: groupSelection,
  },
  {
    id: 'edit.ungroup',
    key: 'g',
    mod: true,
    shift: true,
    label: 'Ungroup',
    group: 'Edit',
    allowWhileTyping: true,
    run: ungroupSelection,
  },
  {
    id: 'edit.delete',
    code: 'Delete',
    label: 'Delete selection',
    group: 'Edit',
    run: deleteSelection,
  },
  {
    id: 'edit.delete2',
    code: 'Backspace',
    label: 'Delete selection',
    group: 'Edit',
    hidden: true,
    run: deleteSelection,
  },

  // ---------------------------------------------------------------- Tools
  ...TOOL_KEYS.map(([code, tool]): Binding => ({
    id: `tool.${tool}`,
    code,
    label: tool[0].toUpperCase() + tool.slice(1),
    group: 'Tools',
    run: () => editor().setTool(tool),
  })),

  // -------------------------------------------------------------- General
  {
    id: 'file.save',
    key: 's',
    mod: true,
    label: 'Save',
    group: 'General',
    allowWhileTyping: true,
    run: () => void saveNow(),
  },
  {
    id: 'help.toggle',
    code: 'Slash',
    shift: true,
    label: 'Keyboard shortcuts',
    group: 'General',
    run: () => editor().setHelpOpen(!editor().helpOpen),
  },
  {
    id: 'view.snap',
    code: 'KeyN',
    label: 'Toggle snapping',
    group: 'General',
    run: T.toggleSnapping,
  },
  {
    id: 'ui.escape',
    code: 'Escape',
    label: 'Close overlay / clear selection',
    group: 'General',
    // The context menu owns Escape while it's open, so this stays out of its way
    // rather than closing the menu and clearing the selection at the same time.
    when: () => !useContextMenu.getState().open,
    run: () => {
      const e = editor();
      if (e.helpOpen) e.setHelpOpen(false);
      else e.clearSelection();
    },
  },
];

/**
 * The binding for an event, or null. Modifiers must match exactly — that's what
 * lets `/`, `?`, `⌘/` and `⌥/` coexist on one physical key, and what stops a
 * plain `L` binding from firing on the browser's ⌘L.
 */
export function matchBinding(e: KeyboardEvent, map: Binding[] = KEYMAP): Binding | null {
  const mod = e.metaKey || e.ctrlKey;
  for (const b of map) {
    if (b.code ? e.code !== b.code : e.key.toLowerCase() !== b.key) continue;
    if (mod !== !!b.mod) continue;
    if (e.shiftKey !== !!b.shift) continue;
    if (e.altKey !== !!b.alt) continue;
    return b;
  }
  return null;
}

const CODE_GLYPHS: Record<string, string> = {
  Slash: '/',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Backspace: '⌫',
  Delete: 'Del',
  Escape: 'Esc',
  Home: 'Home',
  End: 'End',
};

function keyGlyph(b: Binding): string {
  if (b.key) return b.key.toUpperCase();
  const code = b.code ?? '';
  if (CODE_GLYPHS[code]) return CODE_GLYPHS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/** Display string for a binding, e.g. '⌘⇧Z' on macOS or 'Ctrl+Shift+Z' elsewhere. */
export function chordLabel(b: Binding): string {
  const mac = isMac();
  const parts: string[] = [];
  if (b.mod) parts.push(mac ? '⌘' : 'Ctrl');
  if (b.alt) parts.push(mac ? '⌥' : 'Alt');
  if (b.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(keyGlyph(b));
  return mac ? parts.join('') : parts.join('+');
}

/** Display string for a binding id, for tooltips and menus. */
export function chordFor(id: string): string {
  const b = KEYMAP.find((x) => x.id === id);
  return b ? chordLabel(b) : '';
}

import { describe, it, expect } from 'vitest';
import { chordLabel, KEYMAP, matchBinding, type Binding } from './keymap';

/** A minimal stand-in for the fields matchBinding reads. */
function ev(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: '',
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...over,
  } as KeyboardEvent;
}

const id = (e: KeyboardEvent) => matchBinding(e)?.id ?? null;

describe('KEYMAP integrity', () => {
  it('has unique ids', () => {
    const ids = KEYMAP.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no two bindings on the same chord', () => {
    // Guards against a new binding silently shadowing an existing one: only the
    // first match ever runs, so a duplicate chord is a dead shortcut.
    const chords = KEYMAP.map(
      (b) => `${b.code ?? `key:${b.key}`}|${!!b.mod}|${!!b.shift}|${!!b.alt}`,
    );
    const dupes = chords.filter((c, i) => chords.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });

  it('gives every binding a label and a group', () => {
    for (const b of KEYMAP) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.group.length).toBeGreaterThan(0);
    }
  });
});

describe('matchBinding', () => {
  it('disambiguates the four bindings sharing the slash key', () => {
    expect(id(ev({ code: 'Slash', key: '/' }))).toBe('play.around');
    expect(id(ev({ code: 'Slash', key: '?', shiftKey: true }))).toBe('help.toggle');
    expect(id(ev({ code: 'Slash', key: '/', metaKey: true }))).toBe('play.loop');
    expect(id(ev({ code: 'Slash', key: '÷', altKey: true }))).toBe('play.inToOut');
  });

  it('matches Option chords despite macOS rewriting event.key to a dead key', () => {
    // ⌥I reports key 'ˆ', ⌥O reports 'ø', ⌥X reports '≈'. Matching on `code`
    // is the only way these bindings can work at all.
    expect(id(ev({ code: 'KeyI', key: 'ˆ', altKey: true }))).toBe('mark.clearIn');
    expect(id(ev({ code: 'KeyO', key: 'ø', altKey: true }))).toBe('mark.clearOut');
    expect(id(ev({ code: 'KeyX', key: '≈', altKey: true }))).toBe('mark.clearBoth');
    expect(id(ev({ code: 'KeyM', key: 'µ', altKey: true }))).toBe('marker.delete');
  });

  it('distinguishes shifted from unshifted letters', () => {
    expect(id(ev({ code: 'KeyL', key: 'l' }))).toBe('play.forward');
    expect(id(ev({ code: 'KeyL', key: 'L', shiftKey: true }))).toBe('play.faster');
    expect(id(ev({ code: 'KeyJ', key: 'j' }))).toBe('play.reverse');
    expect(id(ev({ code: 'KeyJ', key: 'J', shiftKey: true }))).toBe('play.slower');
  });

  it('leaves browser chords alone (exact modifier matching)', () => {
    // ⌘L focuses the address bar; a plain-L binding must not swallow it.
    expect(id(ev({ code: 'KeyL', key: 'l', metaKey: true }))).toBeNull();
    expect(id(ev({ code: 'KeyK', key: 'k', metaKey: true }))).toBeNull();
    expect(id(ev({ code: 'KeyM', key: 'm', metaKey: true }))).toBeNull();
  });

  it('separates the bracket keyframe bindings by modifier', () => {
    expect(id(ev({ code: 'BracketLeft', key: '[' }))).toBe('nav.prevKey2');
    expect(id(ev({ code: 'BracketLeft', key: '[', metaKey: true }))).toBe('key.add');
  });

  it('matches the legacy mod+letter bindings on the logical key', () => {
    // Layout-independent: on Dvorak, 'z' sits on a different physical key.
    expect(id(ev({ key: 'z', code: 'KeyW', metaKey: true }))).toBe('edit.undo');
    expect(id(ev({ key: 'Z', code: 'KeyW', metaKey: true, shiftKey: true }))).toBe('edit.redo');
    expect(id(ev({ key: 'c', code: 'KeyJ', ctrlKey: true }))).toBe('edit.copy');
  });

  it('matches arrows with and without shift', () => {
    expect(id(ev({ code: 'ArrowLeft' }))).toBe('nav.frameBack');
    expect(id(ev({ code: 'ArrowLeft', shiftKey: true }))).toBe('nav.secBack');
    expect(id(ev({ code: 'ArrowUp' }))).toBe('nav.prevKey');
    expect(id(ev({ code: 'ArrowUp', shiftKey: true }))).toBe('marker.prev');
  });

  it('returns null for unbound keys', () => {
    expect(id(ev({ code: 'KeyR', key: 'r' }))).toBeNull();
    expect(id(ev({ code: 'F13', key: 'F13' }))).toBeNull();
  });
});

describe('chordLabel', () => {
  const label = (b: Partial<Binding>) =>
    chordLabel({ id: 'x', label: '', group: 'General', run: () => {}, ...b } as Binding);

  it('renders plain keys', () => {
    expect(label({ code: 'KeyL' })).toBe('L');
    expect(label({ code: 'Digit3' })).toBe('3');
    expect(label({ code: 'Slash' })).toBe('/');
    expect(label({ code: 'ArrowLeft' })).toBe('←');
    expect(label({ code: 'BracketLeft' })).toBe('[');
  });

  it('prefixes modifiers', () => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    expect(label({ key: 'z', mod: true, shift: true })).toBe(mac ? '⌘⇧Z' : 'Ctrl+Shift+Z');
    expect(label({ code: 'KeyI', alt: true })).toBe(mac ? '⌥I' : 'Alt+I');
  });
});

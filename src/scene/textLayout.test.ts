import { describe, it, expect } from 'vitest';
import {
  buildGlyphObjects,
  isGlyphCustomized,
  layoutText,
  planTextEdit,
  type FontLike,
} from './textLayout';
import { createGlyphObject, createTextObject } from '../state/defaults';
import type { SceneObject, TextParams } from '../state/types';

/** Tiny typeface: every glyph advances 500 units at resolution 1000 (0.5em). */
const font: FontLike = {
  data: {
    resolution: 1000,
    glyphs: {
      A: { ha: 500 },
      B: { ha: 500 },
      C: { ha: 500 },
      '?': { ha: 500 },
    },
  },
};

const params = (text: string, over: Partial<TextParams> = {}): TextParams => ({
  text,
  fontSize: 10, // advance = 5mm/char with this typeface
  depth: 4,
  align: 'left',
  letterSpacing: 0,
  lineHeight: 1.15,
  writeOn: 1,
  ...over,
});

describe('layoutText', () => {
  it('advances the pen by each glyph advance', () => {
    const l = layoutText(font, params('ABC'));
    expect(l.width).toBe(15);
    expect(l.positions[1][0] - l.positions[0][0]).toBeCloseTo(5);
    expect(l.positions[2][0] - l.positions[1][0]).toBeCloseTo(5);
  });

  it('adds letter spacing between characters but not after the last', () => {
    const l = layoutText(font, params('AB', { letterSpacing: 0.1 })); // 1mm
    expect(l.width).toBeCloseTo(11);
    expect(l.positions[1][0] - l.positions[0][0]).toBeCloseTo(6);
  });

  it('left-aligns a single line flush to the origin', () => {
    const l = layoutText(font, params('AB')); // factory default: align 'left'
    expect(l.positions[0][0]).toBeCloseTo(0);
  });

  it('centers a single line on the origin', () => {
    const l = layoutText(font, params('AB', { align: 'center' }));
    // Width 10: centered means the block spans -5..5.
    expect(l.positions[0][0]).toBeCloseTo(-5);
  });

  it('left/center/right each place a different edge of a single line at the origin', () => {
    const left = layoutText(font, params('AB', { align: 'left' }));
    const center = layoutText(font, params('AB', { align: 'center' }));
    const right = layoutText(font, params('AB', { align: 'right' }));
    expect(left.positions[0][0]).toBeCloseTo(0); // left edge at origin
    expect(center.positions[0][0]).toBeCloseTo(-5); // block centered
    expect(right.positions[0][0]).toBeCloseTo(-10); // right edge (start+width=0) at origin
  });

  it('left-aligns every line flush to x=0 regardless of width', () => {
    const l = layoutText(font, params('ABC\nA', { align: 'left' }));
    expect(l.positions[0][0]).toBeCloseTo(0);
    expect(l.positions[4][0]).toBeCloseTo(0);
  });

  it('right-aligns every line so its end sits at x=0', () => {
    const l = layoutText(font, params('ABC\nA', { align: 'right' }));
    expect(l.positions[0][0] + 15).toBeCloseTo(0); // line 0 width 15
    expect(l.positions[4][0] + 5).toBeCloseTo(0); // line 1 width 5
  });

  it('top/center/bottom each place a different edge of the block at y=0', () => {
    const top = layoutText(font, params('A', { vAlign: 'top' }));
    const center = layoutText(font, params('A', { vAlign: 'center' }));
    const bottom = layoutText(font, params('A', { vAlign: 'bottom' }));
    // top: block sits above the origin (elevated) — for a single line, its
    // bottom edge (the baseline, 0 for one line) anchors, so y=0.
    expect(top.positions[0][1]).toBeCloseTo(0);
    expect(center.positions[0][1]).toBeCloseTo(-3.5); // -(top+bottom)/2, bottom=0 for 1 line
    // bottom: block hangs below the origin — its top edge (cap height, 7) anchors.
    expect(bottom.positions[0][1]).toBeCloseTo(-7);
  });

  it('defaults vAlign to center when omitted', () => {
    const withDefault = layoutText(font, params('A'));
    const explicit = layoutText(font, params('A', { vAlign: 'center' }));
    expect(withDefault.positions[0][1]).toBeCloseTo(explicit.positions[0][1]);
  });

  it('vertical align holds across multiple lines', () => {
    const top = layoutText(font, params('A\nB', { vAlign: 'top' }));
    const bottom = layoutText(font, params('A\nB', { vAlign: 'bottom' }));
    // top: block sits above the origin — the last line's baseline (its
    // bottom edge) anchors at y=0.
    const lastLineIdx = top.positions.length - 1;
    expect(top.positions[lastLineIdx][1]).toBeCloseTo(0);
    // bottom: block hangs below the origin — the first line's cap-top anchors
    // at y=0, so its (tracked) baseline sits one cap-height below, at -7.
    expect(bottom.positions[0][1]).toBeCloseTo(-7);
    // Horizontal align is unaffected by the vertical setting.
    expect(top.positions[0][0]).toBeCloseTo(bottom.positions[0][0]);
  });

  it('aligns lines against the widest line', () => {
    const left = layoutText(font, params('ABC\nA'));
    expect(left.positions[4][0]).toBeCloseTo(left.positions[0][0]); // both flush left
    const right = layoutText(font, params('ABC\nA', { align: 'right' }));
    // Short line's single char ends where the long line ends.
    expect(right.positions[4][0]).toBeCloseTo(right.positions[2][0]);
    const center = layoutText(font, params('ABC\nA', { align: 'center' }));
    expect(center.positions[4][0]).toBeCloseTo(-2.5);
  });

  it('stacks lines by lineHeight and gives every index a position', () => {
    const l = layoutText(font, params('AB\nC', { lineHeight: 1.5 }));
    expect(l.positions).toHaveLength(4); // '\n' included
    expect(l.positions[0][1] - l.positions[3][1]).toBeCloseTo(15); // 1.5 * 10
  });

  it('centers Z through the extrusion depth', () => {
    const l = layoutText(font, params('A'));
    expect(l.positions[0][2]).toBe(-2);
  });

  it('falls back to a default advance for unknown glyph sets', () => {
    const bare: FontLike = { data: { resolution: 1000, glyphs: {} } };
    const l = layoutText(bare, params('AB'));
    expect(l.width).toBeCloseTo(10); // 0.5 * fontSize each
  });
});

function textWithGlyphs(text: string, over: Partial<TextParams> = {}) {
  const parent = createTextObject(5000, { text: params(text, over) });
  const glyphs = buildGlyphObjects(parent, font);
  return { parent, glyphs };
}

describe('buildGlyphObjects', () => {
  it('creates one glyph per non-whitespace character with parent traits', () => {
    const { parent, glyphs } = textWithGlyphs('A B\nC');
    expect(glyphs.map((g) => g.glyph!.char)).toEqual(['A', 'B', 'C']);
    expect(glyphs.map((g) => g.glyph!.index)).toEqual([0, 2, 4]);
    for (const g of glyphs) {
      expect(g.parentId).toBe(parent.id);
      expect(g.lifetime).toEqual(parent.lifetime);
      expect(g.material).toEqual(parent.material);
      expect(g.transform.position).toEqual(g.glyph!.layoutPos);
    }
  });
});

describe('isGlyphCustomized', () => {
  it('is false for a freshly reconciled glyph', () => {
    const { parent, glyphs } = textWithGlyphs('AB');
    expect(isGlyphCustomized(glyphs[0], parent)).toBe(false);
  });

  it.each([
    ['keyframes', (g: SceneObject) => (g.tracks.opacity = [{ id: 'k', timeMs: 0, value: 1, interpolation: 'linear' }])],
    ['recolor', (g: SceneObject) => (g.material = { ...g.material, color: '#ff0000' })],
    ['moved', (g: SceneObject) => (g.transform.position = [99, 0, 0])],
    ['rotated', (g: SceneObject) => (g.transform.rotation = [0, 0, 45])],
    ['idle', (g: SceneObject) => (g.idle = { type: 'pulse', speed: 1, axis: 'z' })],
    ['lifetime', (g: SceneObject) => (g.lifetime = { startMs: 100, endMs: 900 })],
    ['renamed', (g: SceneObject) => (g.name = 'my letter')],
  ])('detects %s', (_label, mutate) => {
    const { parent, glyphs } = textWithGlyphs('AB');
    mutate(glyphs[0]);
    expect(isGlyphCustomized(glyphs[0], parent)).toBe(true);
  });
});

describe('planTextEdit', () => {
  it('appending keeps existing glyphs and adds new ones', () => {
    const { parent, glyphs } = textWithGlyphs('AB');
    const plan = planTextEdit(parent, glyphs, params('ABC'), font);
    expect(plan.removedIds).toEqual([]);
    expect(plan.added.map((a) => a.char)).toEqual(['C']);
    expect(plan.added[0].index).toBe(2);
    expect(plan.moved).toHaveLength(2);
  });

  it('deleting in the middle removes exactly the deleted characters', () => {
    const { parent, glyphs } = textWithGlyphs('ABC');
    const plan = planTextEdit(parent, glyphs, params('AC'), font);
    const removed = glyphs.filter((g) => plan.removedIds.includes(g.id));
    expect(removed.map((g) => g.glyph!.char)).toEqual(['B']);
    // The surviving suffix glyph shifts to its new index.
    const moved = plan.moved.find((m) => m.id === glyphs[2].id)!;
    expect(moved.index).toBe(1);
  });

  it('re-anchors surviving glyphs to the new layout', () => {
    const { parent, glyphs } = textWithGlyphs('AB');
    const plan = planTextEdit(parent, glyphs, params('AB', { fontSize: 20 }), font);
    expect(plan.removedIds).toEqual([]);
    expect(plan.added).toEqual([]);
    const expected = layoutText(font, params('AB', { fontSize: 20 }));
    for (const m of plan.moved) {
      const g = glyphs.find((x) => x.id === m.id)!;
      expect(m.layoutPos).toEqual(expected.positions[g.glyph!.index]);
    }
  });

  it('flags customized glyphs among the removed', () => {
    const { parent, glyphs } = textWithGlyphs('ABC');
    glyphs[1].material = { ...glyphs[1].material, color: '#ff0000' };
    const plan = planTextEdit(parent, glyphs, params('AC'), font);
    expect(plan.removedCustomized).toEqual([{ id: glyphs[1].id, char: 'B' }]);
  });

  it('does not flag untouched removed glyphs', () => {
    const { parent, glyphs } = textWithGlyphs('ABC');
    const plan = planTextEdit(parent, glyphs, params('AC'), font);
    expect(plan.removedCustomized).toEqual([]);
  });

  it('replacing everything removes and recreates all glyphs', () => {
    const { parent, glyphs } = textWithGlyphs('AB');
    const plan = planTextEdit(parent, glyphs, params('CC'), font);
    expect(plan.removedIds).toHaveLength(2);
    expect(plan.added.map((a) => a.char)).toEqual(['C', 'C']);
  });

  it('whitespace gets no glyph but consumes an index', () => {
    const { parent, glyphs } = textWithGlyphs('A');
    const plan = planTextEdit(parent, glyphs, params('A B'), font);
    expect(plan.added.map((a) => a.char)).toEqual(['B']);
    expect(plan.added[0].index).toBe(2);
  });
});

describe('glyph index bookkeeping', () => {
  it('createGlyphObject copies rather than aliases the layout position', () => {
    const parent = createTextObject(5000);
    const g = createGlyphObject(parent, 'A', 0, [1, 2, 3]);
    g.transform.position[0] = 99;
    expect(g.glyph!.layoutPos[0]).toBe(1);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveScene, useDocumentStore } from './documentStore';
import { createDefaultProject, createTextObject } from './defaults';
import {
  buildGlyphObjects,
  planTextEdit,
  type FontLike,
} from '../scene/textLayout';
import type { SceneObject, TextParams } from './types';

const api = () => useDocumentStore.getState();
const objects = () => getActiveScene(api().project).objects;
const find = (id: string) => objects().find((o) => o.id === id);

/** Tiny typeface: every glyph advances 500 units at resolution 1000. */
const font: FontLike = {
  data: {
    resolution: 1000,
    glyphs: { A: { ha: 500 }, B: { ha: 500 }, C: { ha: 500 }, '?': { ha: 500 } },
  },
};

/** Adds a text object with reconciled glyph children; returns the parent. */
function addText(text: string, over: Partial<TextParams> = {}): SceneObject {
  const parent = createTextObject(5000, { text: { text, align: 'left', ...over } });
  api().addObjects([parent, ...buildGlyphObjects(parent, font)]);
  return find(parent.id)!;
}

const glyphsOf = (parentId: string) =>
  objects().filter((o) => o.parentId === parentId && o.type === 'glyph');

describe('documentStore text actions', () => {
  beforeEach(() => {
    api().setProject(createDefaultProject());
  });

  it('applyTextEdit reconciles children on a text change', () => {
    const parent = addText('AB');
    expect(glyphsOf(parent.id)).toHaveLength(2);
    const plan = planTextEdit(parent, glyphsOf(parent.id), { ...parent.text!, text: 'ABC' }, font);
    api().applyTextEdit(parent.id, plan);
    expect(find(parent.id)!.text!.text).toBe('ABC');
    expect(glyphsOf(parent.id).map((g) => g.glyph!.char).sort()).toEqual(['A', 'B', 'C']);
  });

  it('preserves a user offset (and shifts position keyframes) across re-layout', () => {
    const parent = addText('AB');
    const g = glyphsOf(parent.id)[0];
    // User nudges the glyph 5mm up and keys its X position.
    api().patchObjectTransform(g.id, {
      position: [g.transform.position[0], g.transform.position[1] + 5, g.transform.position[2]],
    });
    api().setChannelKeyframeValue(`object:${g.id}:position:0`, 0, g.transform.position[0]);

    const before = find(g.id)!;
    const oldLayoutX = before.glyph!.layoutPos[0];
    const plan = planTextEdit(
      find(parent.id)!,
      glyphsOf(parent.id),
      { ...parent.text!, fontSize: 80 }, // doubles every advance
      font,
    );
    api().applyTextEdit(parent.id, plan);

    const after = find(g.id)!;
    const deltaX = after.glyph!.layoutPos[0] - oldLayoutX;
    // Offset preserved relative to the new anchor.
    expect(after.transform.position[1] - after.glyph!.layoutPos[1]).toBeCloseTo(5);
    // Keyframe values shifted by the same layout delta.
    expect(Number(after.tracks['position.0']![0].value)).toBeCloseTo(
      Number(before.tracks['position.0']![0].value) + deltaX,
    );
  });

  it('deleting a glyph splices its character out of the parent text and re-indexes', () => {
    const parent = addText('ABC');
    const middle = glyphsOf(parent.id).find((g) => g.glyph!.char === 'B')!;
    api().removeObjects([middle.id]);
    expect(find(parent.id)!.text!.text).toBe('AC');
    const remaining = glyphsOf(parent.id);
    expect(remaining.map((g) => g.glyph!.char)).toEqual(['A', 'C']);
    expect(remaining.map((g) => g.glyph!.index)).toEqual([0, 1]);
  });

  it('deleting the text parent removes all its glyphs', () => {
    const parent = addText('AB');
    api().removeObjects([parent.id]);
    expect(objects().filter((o) => o.type === 'glyph')).toHaveLength(0);
  });

  it('setTextMaterial cascades to matching glyphs but spares customized ones', () => {
    const parent = addText('AB');
    const [a, b] = glyphsOf(parent.id);
    api().setObjectMaterial(b.id, { color: '#ff0000' }); // user-customized glyph
    api().setTextMaterial(parent.id, { color: '#00ff00' });
    expect(find(parent.id)!.material.color).toBe('#00ff00');
    expect(find(a.id)!.material.color).toBe('#00ff00');
    expect(find(b.id)!.material.color).toBe('#ff0000');
  });

  it('setObjectText patches non-layout params without touching children', () => {
    const parent = addText('AB');
    const childIds = glyphsOf(parent.id).map((g) => g.id);
    api().setObjectText(parent.id, { writeOn: 0.3 });
    expect(find(parent.id)!.text!.writeOn).toBe(0.3);
    expect(glyphsOf(parent.id).map((g) => g.id)).toEqual(childIds);
  });

  it('resolves the text.writeOn channel for keyframing', () => {
    const parent = addText('AB', { writeOn: 0.4 });
    api().cycleKeyframe(`object:${parent.id}:text:writeOn`, 1000);
    const track = find(parent.id)!.tracks['text.writeOn']!;
    expect(track).toHaveLength(1);
    expect(track[0].value).toBe(0.4);
  });
});

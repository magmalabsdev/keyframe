/**
 * Layout + reconciliation for 3D text objects.
 *
 * A 'text' object is a container whose 'glyph' children each render one
 * character. This module computes per-character pen positions from typeface
 * metrics and diffs an edited text string against the existing children,
 * producing a plan the document store applies in one undo step.
 *
 * Character indices are positions in `Array.from(text)` (code points), and
 * whitespace/newlines consume an index (so write-on pacing counts them) but
 * get no glyph object.
 */
import type { Material, SceneObject, TextParams, Vec3 } from '../state/types';
import { createGlyphObject } from '../state/defaults';

/**
 * The subset of three's `Font` that layout needs. Kept structural so tests can
 * hand-build tiny typefaces without constructing a real Font.
 */
export interface FontLike {
  data: {
    /** Per-character glyph metrics; `ha` is the horizontal advance. */
    glyphs: Record<string, { ha: number } | undefined>;
    /** Units-per-em of the typeface metrics (1000 for TTFLoader output). */
    resolution: number;
  };
}

/** Approximate cap height as a fraction of em size, used to center vertically. */
const CAP_HEIGHT = 0.7;

const isWhitespace = (c: string) => /\s/.test(c);

/** Horizontal advance of one character in mm (excluding letter spacing). */
function advanceOf(font: FontLike, char: string, fontSize: number): number {
  const scale = fontSize / font.data.resolution;
  const glyph = font.data.glyphs[char] ?? font.data.glyphs['?'];
  return glyph ? glyph.ha * scale : fontSize * 0.5;
}

export interface TextLayout {
  /** Pen position (left edge, baseline) for every character index. */
  positions: Vec3[];
  /** Width of the widest line (mm). */
  width: number;
  /** Total block height (mm). */
  height: number;
}

/**
 * Lays out every character of `params.text`. Each align axis is independent:
 * a non-center value places the object origin at that named edge of the block,
 * with the block sitting on the far side of it — e.g. horizontal 'left' puts
 * the block's left edge at x=0 (text extends rightward, away from x=0);
 * vertical 'top' puts the origin at the block's BOTTOM edge, so the block
 * sits above the origin (elevated); 'bottom' puts the origin at the block's
 * top edge, so it hangs below. This matches how the move handle is expected
 * to sit relative to the text: 'top' raises the text up off the handle,
 * 'bottom' lets it hang down from the handle. 'center' on either axis centers
 * the block on that axis, as before. Z is always centered through the
 * extrusion depth, independent of both.
 */
export function layoutText(
  font: FontLike,
  params: Pick<
    TextParams,
    'text' | 'fontSize' | 'depth' | 'align' | 'vAlign' | 'letterSpacing' | 'lineHeight'
  >,
): TextLayout {
  const { fontSize, letterSpacing, lineHeight, align } = params;
  const vAlign = params.vAlign ?? 'center';
  const chars = Array.from(params.text);
  const spacing = letterSpacing * fontSize;

  // Split into lines of (charIndex, char) so indices survive the newlines.
  const lines: { start: number; chars: string[] }[] = [{ start: 0, chars: [] }];
  chars.forEach((c, i) => {
    if (c === '\n') lines.push({ start: i + 1, chars: [] });
    else lines[lines.length - 1].chars.push(c);
  });

  const lineWidth = (line: string[]) => {
    let w = 0;
    for (const c of line) w += advanceOf(font, c, fontSize) + spacing;
    return line.length > 0 ? w - spacing : 0;
  };
  const widths = lines.map((l) => lineWidth(l.chars));
  const maxWidth = Math.max(0, ...widths);

  // Where the block-local frame (x=0..maxWidth) lands relative to the origin.
  const blockAnchorOffset =
    align === 'left' ? 0 : align === 'right' ? -maxWidth : -maxWidth / 2;

  // Baselines run from y=0 downward; an approximate cap height stands in for
  // the top line's ascender (no true font ascent/descent metrics available).
  const top = CAP_HEIGHT * fontSize;
  const bottom = -(lines.length - 1) * lineHeight * fontSize;
  // 'top' anchors the origin to the block's bottom edge (block sits above,
  // elevated); 'bottom' anchors it to the block's top edge (block hangs
  // below) — the origin/anchor takes the OPPOSITE extent from the align name.
  const verticalAnchor = vAlign === 'top' ? bottom : vAlign === 'bottom' ? top : (top + bottom) / 2;
  const z = -params.depth / 2;

  const positions: Vec3[] = new Array(chars.length);
  lines.forEach((line, li) => {
    // Ragged lines follow the same direction as the block anchor: flush left,
    // flush right, or each line individually centered within the block.
    const perLineOffset =
      align === 'left' ? 0 : align === 'right' ? maxWidth - widths[li] : (maxWidth - widths[li]) / 2;
    const startX = blockAnchorOffset + perLineOffset;
    const y = -li * lineHeight * fontSize - verticalAnchor;
    let pen = startX;
    let idx = line.start;
    for (const c of line.chars) {
      positions[idx] = [pen, y, z];
      pen += advanceOf(font, c, fontSize) + spacing;
      idx += 1;
    }
    // The newline character (if any) sits at the end-of-line pen position.
    if (li < lines.length - 1) positions[lines[li + 1].start - 1] = [pen, y, z];
  });

  return { positions, width: maxWidth, height: top - bottom };
}

/** Fresh glyph children for a text object (used when first creating it). */
export function buildGlyphObjects(parent: SceneObject, font: FontLike): SceneObject[] {
  const params = parent.text;
  if (!params) return [];
  const layout = layoutText(font, params);
  return Array.from(params.text).flatMap((c, i) =>
    isWhitespace(c) ? [] : [createGlyphObject(parent, c, i, layout.positions[i])],
  );
}

const vecEq = (a: Vec3, b: Vec3, eps = 1e-6) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;

export function materialsEqual(a: Material, b: Material): boolean {
  return (
    a.color === b.color &&
    a.opacity === b.opacity &&
    a.metalness === b.metalness &&
    a.roughness === b.roughness &&
    a.textureAssetId === b.textureAssetId
  );
}

/**
 * Whether a glyph has been edited away from what reconciliation would recreate
 * (keyframes, its own color, transforms, animations, lifetime, or a rename).
 * Deleting such a glyph loses user work, so text edits confirm first.
 */
export function isGlyphCustomized(glyph: SceneObject, parent: SceneObject): boolean {
  if (!glyph.glyph) return false;
  const tracks = glyph.tracks ?? {};
  if (Object.values(tracks).some((t) => (t?.length ?? 0) > 0)) return true;
  if (!materialsEqual(glyph.material, parent.material)) return true;
  if (glyph.idle && glyph.idle.type !== 'none') return true;
  if (glyph.startAnim && glyph.startAnim.type !== 'none') return true;
  if (glyph.endAnim && glyph.endAnim.type !== 'none') return true;
  if (!vecEq(glyph.transform.rotation, [0, 0, 0])) return true;
  if (!vecEq(glyph.transform.scale, [1, 1, 1])) return true;
  if (!vecEq(glyph.centerOfRotation, [0, 0, 0])) return true;
  if (!vecEq(glyph.transform.position, glyph.glyph.layoutPos)) return true;
  if (
    glyph.lifetime.startMs !== parent.lifetime.startMs ||
    glyph.lifetime.endMs !== parent.lifetime.endMs
  ) {
    return true;
  }
  if (glyph.name !== `'${glyph.glyph.char}'`) return true;
  return false;
}

export interface TextEditPlan {
  /** The full params to write onto the parent. */
  params: TextParams;
  /** Glyph object ids to delete. */
  removedIds: string[];
  /** The deleted glyphs that carry user customizations (drives the confirm). */
  removedCustomized: { id: string; char: string }[];
  /** New glyphs to create. */
  added: { char: string; index: number; layoutPos: Vec3 }[];
  /** Surviving glyphs: new index + layout anchor (position delta is preserved). */
  moved: { id: string; index: number; layoutPos: Vec3 }[];
}

/**
 * Diffs a text-param edit into a reconciliation plan. Retained characters are
 * matched by longest common prefix/suffix (covers ordinary typing and
 * deleting); everything else is removed/recreated.
 */
export function planTextEdit(
  parent: SceneObject,
  glyphs: SceneObject[],
  newParams: TextParams,
  font: FontLike,
): TextEditPlan {
  const oldChars = Array.from(parent.text?.text ?? '');
  const newChars = Array.from(newParams.text);
  const layout = layoutText(font, newParams);

  let prefix = 0;
  while (
    prefix < oldChars.length &&
    prefix < newChars.length &&
    oldChars[prefix] === newChars[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  /** Maps a retained old index to its new index, or undefined if removed. */
  const newIndexOf = (i: number): number | undefined => {
    if (i < prefix) return i;
    if (i >= oldChars.length - suffix) return i + (newChars.length - oldChars.length);
    return undefined;
  };

  const byIndex = new Map<number, SceneObject>();
  for (const g of glyphs) if (g.glyph) byIndex.set(g.glyph.index, g);

  const removedIds: string[] = [];
  const removedCustomized: { id: string; char: string }[] = [];
  const moved: TextEditPlan['moved'] = [];
  const covered = new Set<number>();

  for (const [oldIndex, g] of byIndex) {
    const ni = newIndexOf(oldIndex);
    if (ni === undefined) {
      removedIds.push(g.id);
      if (isGlyphCustomized(g, parent)) {
        removedCustomized.push({ id: g.id, char: g.glyph!.char });
      }
    } else {
      covered.add(ni);
      moved.push({ id: g.id, index: ni, layoutPos: layout.positions[ni] });
    }
  }

  const added: TextEditPlan['added'] = [];
  newChars.forEach((c, i) => {
    if (!covered.has(i) && !isWhitespace(c)) {
      added.push({ char: c, index: i, layoutPos: layout.positions[i] });
    }
  });

  return { params: newParams, removedIds, removedCustomized, added, moved };
}

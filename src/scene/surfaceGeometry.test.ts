import { describe, expect, it } from 'vitest';
import type { Point2 } from '../state/types';
import {
  buildSurfaceGeometry,
  getSurfaceGeometry,
  normalizeWinding,
  polygonBounds,
  polygonCentroid,
  polygonSignedArea,
} from './surfaceGeometry';

const RECT: Point2[] = [
  [-100, -60],
  [100, -60],
  [100, 60],
  [-100, 60],
];

/** Concave L: triangulation must not emit anything outside the bbox. */
const L_SHAPE: Point2[] = [
  [0, 0],
  [100, 0],
  [100, 40],
  [40, 40],
  [40, 100],
  [0, 100],
];

describe('polygonSignedArea / normalizeWinding', () => {
  it('reports positive area for counter-clockwise input', () => {
    expect(polygonSignedArea(RECT)).toBeGreaterThan(0);
  });

  it('flips clockwise input to counter-clockwise', () => {
    const cw = [...RECT].reverse();
    expect(polygonSignedArea(cw)).toBeLessThan(0);
    expect(polygonSignedArea(normalizeWinding(cw))).toBeGreaterThan(0);
  });

  it('leaves counter-clockwise input untouched', () => {
    expect(normalizeWinding(RECT)).toBe(RECT);
  });
});

describe('polygonBounds / polygonCentroid', () => {
  it('measures the bounding box', () => {
    expect(polygonBounds(RECT)).toMatchObject({
      minX: -100,
      minY: -60,
      maxX: 100,
      maxY: 60,
      w: 200,
      h: 120,
    });
  });

  it('centers a symmetric rectangle on the origin', () => {
    const [cx, cy] = polygonCentroid(RECT);
    expect(cx).toBeCloseTo(0);
    expect(cy).toBeCloseTo(0);
  });

  it('falls back to the bbox center for a degenerate polygon', () => {
    const [cx, cy] = polygonCentroid([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    expect(cx).toBeCloseTo(10);
    expect(cy).toBeCloseTo(0);
  });
});

describe('buildSurfaceGeometry', () => {
  it('triangulates a rectangle into two triangles', () => {
    const geo = buildSurfaceGeometry(RECT);
    const index = geo.getIndex();
    expect(index).not.toBeNull();
    expect(index!.count).toBe(6);
  });

  it('normalizes UVs to the polygon bbox', () => {
    // Regression guard: ShapeGeometry writes UVs in raw mm coordinates, so
    // without renormalization a 200mm polygon would get UVs spanning 0..200.
    const geo = buildSurfaceGeometry(RECT);
    const uv = geo.getAttribute('uv');
    const position = geo.getAttribute('position');

    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      expect(u).toBeGreaterThanOrEqual(-1e-6);
      expect(u).toBeLessThanOrEqual(1 + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);

      // The bbox corners must land exactly on (0,0) and (1,1).
      if (position.getX(i) === -100 && position.getY(i) === -60) {
        expect(u).toBeCloseTo(0);
        expect(v).toBeCloseTo(0);
        sawMin = true;
      }
      if (position.getX(i) === 100 && position.getY(i) === 60) {
        expect(u).toBeCloseTo(1);
        expect(v).toBeCloseTo(1);
        sawMax = true;
      }
    }
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it('triangulates a concave polygon within its bounds', () => {
    const geo = buildSurfaceGeometry(L_SHAPE);
    const index = geo.getIndex();
    expect(index!.count).toBeGreaterThanOrEqual(12); // >= 4 triangles

    const position = geo.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      expect(position.getX(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(position.getX(i)).toBeLessThanOrEqual(100 + 1e-6);
      expect(position.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(position.getY(i)).toBeLessThanOrEqual(100 + 1e-6);
      expect(position.getZ(i)).toBeCloseTo(0);
    }
  });

  it('computes bounds needed by marquee selection and raycasting', () => {
    const geo = buildSurfaceGeometry(RECT);
    expect(geo.boundingBox).not.toBeNull();
    expect(geo.boundingSphere).not.toBeNull();
    expect(geo.boundingBox!.min.x).toBeCloseTo(-100);
    expect(geo.boundingBox!.max.y).toBeCloseTo(60);
  });
});

describe('getSurfaceGeometry', () => {
  it('reuses one geometry for structurally equal point lists', () => {
    const a = getSurfaceGeometry([...RECT]);
    const b = getSurfaceGeometry(RECT.map((p) => [...p] as Point2));
    expect(a).toBe(b);
  });

  it('builds a distinct geometry for a different outline', () => {
    const a = getSurfaceGeometry(RECT);
    const b = getSurfaceGeometry(L_SHAPE);
    expect(a).not.toBe(b);
  });
});

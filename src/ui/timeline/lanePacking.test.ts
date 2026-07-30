import { describe, it, expect } from 'vitest';
import { packLanes, buildObjectRows } from './lanePacking';
import type { SceneObject } from '../../state/types';

function obj(id: string, startMs: number, endMs: number, partial: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name: id,
    type: 'mesh',
    parentId: null,
    assetId: 'a',
    visible: true,
    lifetime: { startMs, endMs },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#fff', opacity: 1, metalness: 0, roughness: 1 },
    ...partial,
  };
}

const laneOf = (lanes: SceneObject[][], id: string) => lanes.findIndex((l) => l.some((o) => o.id === id));

describe('packLanes', () => {
  it('shares a lane for non-overlapping objects', () => {
    const a = obj('a', 0, 100);
    const b = obj('b', 200, 300);
    const lanes = packLanes([a, b], new Map());
    expect(lanes).toHaveLength(1);
  });

  it('splits overlapping objects into separate lanes', () => {
    const a = obj('a', 0, 200);
    const b = obj('b', 100, 300);
    const lanes = packLanes([a, b], new Map());
    expect(lanes).toHaveLength(2);
  });

  it('keeps a remembered lane stable when a clip is dragged to the same start as another, unrelated clip', () => {
    // Three objects, each initially in its own lane.
    const memory = new Map<string, number>();
    let a = obj('a', 0, 500);
    let b = obj('b', 600, 1000);
    let c = obj('c', 1100, 1500);
    let lanes = packLanes([a, b, c], memory);
    // No overlaps at all, so first pass already shares lane 0.
    expect(lanes).toHaveLength(1);
    const laneA0 = laneOf(lanes, 'a');
    const laneC0 = laneOf(lanes, 'c');

    // Now drag "b" so it starts at the same time as "a" (creating a genuine
    // overlap only between a and b) — c is completely unrelated and must not
    // move, regardless of drag order or which id sorts first/last.
    b = obj('b', 0, 400);
    lanes = packLanes([a, b, c], memory);
    expect(laneOf(lanes, 'a')).toBe(laneA0);
    expect(laneOf(lanes, 'c')).toBe(laneC0);
  });

  it('does not reorder unrelated clips due to floating-point/order jitter at tie startMs', () => {
    const memory = new Map<string, number>();
    const a = obj('a', 0, 100);
    const b = obj('b', 200, 300);
    const c = obj('c', 400, 500);
    let lanes = packLanes([a, b, c], memory);
    expect(lanes).toHaveLength(1);
    const laneB = laneOf(lanes, 'b');
    const laneC = laneOf(lanes, 'c');

    // Re-pack repeatedly with objects in the same array order (as would
    // happen across re-renders/drag ticks) — lanes must stay identical.
    for (let i = 0; i < 5; i++) {
      lanes = packLanes([a, b, c], memory);
      expect(laneOf(lanes, 'b')).toBe(laneB);
      expect(laneOf(lanes, 'c')).toBe(laneC);
    }
  });

  it('bumps only the object whose remembered lane now genuinely conflicts, keeping the incumbent in place', () => {
    const memory = new Map<string, number>();
    // a and b start non-overlapping, sharing lane 0; c overlaps a, forcing lane 1.
    const a = obj('a', 0, 500);
    const b = obj('b', 600, 1000);
    const c = obj('c', 100, 300);
    let lanes = packLanes([a, b, c], memory);
    expect(laneOf(lanes, 'a')).toBe(0);
    expect(laneOf(lanes, 'c')).toBe(1);
    const laneB0 = laneOf(lanes, 'b');

    // Now b is dragged to overlap ONLY a (not c) — a comes first in array
    // order, so a keeps lane 0 and b, the one whose lifetime changed, gets
    // bumped; c must be completely unaffected since it never overlaps b.
    const bMoved = obj('b', 50, 90);
    lanes = packLanes([a, bMoved, c], memory);
    expect(laneOf(lanes, 'a')).toBe(0);
    expect(laneOf(lanes, 'b')).not.toBe(0);
    // c, wholly unrelated to b's move, must not have been touched.
    expect(laneOf(lanes, 'c')).toBe(1);
    void laneB0;
  });

  it('reuses freed lanes for first-time placement', () => {
    const a = obj('a', 0, 100);
    const b = obj('b', 100, 200);
    const c = obj('c', 0, 50); // overlaps a, needs its own lane
    const lanes = packLanes([a, b, c], new Map());
    expect(lanes).toHaveLength(2);
  });

  it('compacts a gap left by a removed object rather than leaving a blank lane', () => {
    const memory = new Map<string, number>();
    const a = obj('a', 0, 100);
    const b = obj('b', 0, 100); // overlaps a -> lane 1
    let lanes = packLanes([a, b], memory);
    expect(laneOf(lanes, 'a')).toBe(0);
    expect(laneOf(lanes, 'b')).toBe(1);

    // "a" is removed; "b" (still remembering raw lane 1) must not leave a
    // permanent blank lane 0 — it should compact down to lane 0.
    lanes = packLanes([b], memory);
    expect(lanes).toHaveLength(1);
    expect(laneOf(lanes, 'b')).toBe(0);
  });
});

describe('buildObjectRows', () => {
  it('prunes remembered lanes for deleted objects', () => {
    const memory = new Map<string, number>();
    const a = obj('a', 0, 100);
    buildObjectRows([a], new Set(), memory);
    expect(memory.has('a')).toBe(true);

    // "a" is gone now — its stale entry should be dropped, not linger forever.
    buildObjectRows([], new Set(), memory);
    expect(memory.has('a')).toBe(false);
  });

  it('groups children into indented rows only when expanded', () => {
    const parent = obj('p', 0, 1000, { type: 'group' });
    const child = obj('c', 0, 500, { parentId: 'p' });
    const collapsed = buildObjectRows([parent, child], new Set(), new Map());
    expect(collapsed.some((r) => r.depth === 1)).toBe(false);

    const expanded = buildObjectRows([parent, child], new Set(['p']), new Map());
    expect(expanded.some((r) => r.depth === 1 && r.clips.some((o) => o.id === 'c'))).toBe(true);
  });
});

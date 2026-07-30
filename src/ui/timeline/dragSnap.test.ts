import { describe, it, expect } from 'vitest';
import { clampDeltaToStart, snapBodyDelta } from './dragSnap';

/** A snapper that pulls to the nearest multiple of `grid` within `threshold`. */
const gridSnap = (grid: number, threshold: number) => (ms: number) => {
  const nearest = Math.round(ms / grid) * grid;
  return Math.abs(nearest - ms) < threshold ? nearest : ms;
};

const identity = (ms: number) => ms;

describe('snapBodyDelta', () => {
  it('returns the raw delta unchanged when the snapper is identity', () => {
    expect(snapBodyDelta(1000, 2000, 137.4, identity)).toBe(137.4);
    expect(snapBodyDelta(1000, 2000, -42.9, identity)).toBe(-42.9);
  });

  it('returns the raw delta unchanged when both edges are out of snap range', () => {
    // Edges land at 1500/2500, both 500 from the nearest 1000-grid point,
    // well outside a 50ms threshold.
    expect(snapBodyDelta(1000, 2000, 500, gridSnap(1000, 50))).toBe(500);
  });

  it('snaps via the start edge when it is the closer one', () => {
    // start 1000 -> 1990 (10 from 2000); end 2000 -> 2990 (10 from 3000).
    // Tie at 10 each; start wins by the tie rule. Both give +10.
    expect(snapBodyDelta(1000, 2000, 990, gridSnap(1000, 50))).toBe(1000);
  });

  it('uses the end edge when only the end edge has a target in range', () => {
    // The single snap target is 1550. start 1000+40 = 1040 is far from it (no
    // candidate); end 1500+40 = 1540 is 10 away -> correction +10.
    // This is the regression case: a zero correction on the start edge must not
    // veto the end edge's real one.
    const snap = (ms: number) => (Math.abs(ms - 1550) < 30 ? 1550 : ms);
    expect(snapBodyDelta(1000, 1500, 40, snap)).toBe(50);
  });

  it('uses the start edge when only the start edge has a target in range', () => {
    const snap = (ms: number) => (Math.abs(ms - 1050) < 30 ? 1050 : ms);
    // start 1000+40 = 1040 is 10 from 1050 -> +10; end 1500+40 = 1540 has none.
    expect(snapBodyDelta(1000, 1500, 40, snap)).toBe(50);
  });

  it('prefers the nearer edge when both have targets in range', () => {
    // start target 1050 (start 1040 -> +10), end target 1560 (end 1540 -> +20).
    const snap = (ms: number) => {
      if (Math.abs(ms - 1050) < 30) return 1050;
      if (Math.abs(ms - 1560) < 30) return 1560;
      return ms;
    };
    expect(snapBodyDelta(1000, 1500, 40, snap)).toBe(50); // start's +10 wins
  });

  it('preserves duration exactly (the same correction hits both edges)', () => {
    const start = 1234.567;
    const end = 4321.891;
    const duration = end - start;
    const delta = snapBodyDelta(start, end, 777.3, gridSnap(1000, 100));
    expect(end + delta - (start + delta)).toBe(duration);
  });

  it('works symmetrically for a leftward (negative) drag', () => {
    // start 3000 -> 3000-1010 = 1990, 10 from 2000 -> correction +10.
    expect(snapBodyDelta(3000, 4000, -1010, gridSnap(1000, 50))).toBe(-1000);
  });

  it('handles a zero-duration clip without NaN', () => {
    const out = snapBodyDelta(1000, 1000, 990, gridSnap(1000, 50));
    expect(Number.isNaN(out)).toBe(false);
    expect(out).toBe(1000);
  });

  it('never moves further than the snapper itself moves a value', () => {
    const threshold = 50;
    const snap = gridSnap(1000, threshold);
    for (const raw of [0, 13, 137.4, 499, 501, -222, 990]) {
      const out = snapBodyDelta(1000, 2000, raw, snap);
      expect(Math.abs(out - raw)).toBeLessThan(threshold);
    }
  });
});

describe('clampDeltaToStart', () => {
  it('pins a too-negative delta so the start lands exactly at 0', () => {
    expect(clampDeltaToStart(500, -900)).toBe(-500);
  });

  it('leaves an in-range delta untouched', () => {
    expect(clampDeltaToStart(500, -200)).toBe(-200);
    expect(clampDeltaToStart(500, 3000)).toBe(3000);
  });

  it('keeps a clip already at 0 pinned at 0 when dragged left', () => {
    expect(clampDeltaToStart(0, 250)).toBe(250);
    // Assert the resulting start position rather than the delta's sign of zero.
    expect(0 + clampDeltaToStart(0, -250)).toBe(0);
  });
});

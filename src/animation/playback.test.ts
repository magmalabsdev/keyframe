import { describe, it, expect } from 'vitest';
import { advancePlayhead, type AdvanceInput } from './playback';

const base: AdvanceInput = {
  timeMs: 0,
  rate: 1,
  deltaMs: 16,
  durationMs: 5000,
  loop: false,
  inMs: null,
  outMs: null,
  stopAtMs: null,
};
const run = (over: Partial<AdvanceInput> = {}) => advancePlayhead({ ...base, ...over });

describe('advancePlayhead', () => {
  it('advances by delta * rate', () => {
    expect(run({ timeMs: 1000 }).timeMs).toBeCloseTo(1016);
    expect(run({ timeMs: 1000, rate: 2 }).timeMs).toBeCloseTo(1032);
    expect(run({ timeMs: 1000, rate: -1 }).timeMs).toBeCloseTo(984);
  });

  it('stops exactly at the end going forward', () => {
    const r = run({ timeMs: 4990, deltaMs: 20 });
    expect(r.timeMs).toBe(5000);
    expect(r.stop).toBe(true);
  });

  it('stops exactly at zero going backward', () => {
    const r = run({ timeMs: 10, rate: -1, deltaMs: 20 });
    expect(r.timeMs).toBe(0);
    expect(r.stop).toBe(true);
  });

  it('loops forward carrying the overshoot so no time is dropped', () => {
    const r = run({ timeMs: 4990, deltaMs: 20, loop: true });
    expect(r.stop).toBe(false);
    expect(r.timeMs).toBeCloseTo(10);
  });

  it('loops backward to the end', () => {
    const r = run({ timeMs: 10, rate: -1, deltaMs: 20, loop: true });
    expect(r.stop).toBe(false);
    expect(r.timeMs).toBeCloseTo(4990);
  });

  describe('with an in/out range', () => {
    const range = { inMs: 1000, outMs: 2000 };

    it('stops at the out point instead of the scene end', () => {
      const r = run({ ...range, timeMs: 1990, deltaMs: 20 });
      expect(r.timeMs).toBe(2000);
      expect(r.stop).toBe(true);
    });

    it('stops at the in point when reversing', () => {
      const r = run({ ...range, timeMs: 1010, rate: -1, deltaMs: 20 });
      expect(r.timeMs).toBe(1000);
      expect(r.stop).toBe(true);
    });

    it('loops from out back to in', () => {
      const r = run({ ...range, timeMs: 1990, deltaMs: 20, loop: true });
      expect(r.stop).toBe(false);
      expect(r.timeMs).toBeCloseTo(1010);
    });

    it('does not teleport a playhead parked past the out point', () => {
      // Scrubbing past the range and hitting play should run to the real end,
      // not jump backwards into the range.
      const r = run({ ...range, timeMs: 3000, deltaMs: 20 });
      expect(r.stop).toBe(false);
      expect(r.timeMs).toBeCloseTo(3020);
    });

    it('falls back to the whole scene for an inverted range', () => {
      const r = run({ timeMs: 1000, inMs: 3000, outMs: 2000 });
      expect(r.timeMs).toBeCloseTo(1016);
      expect(r.stop).toBe(false);
    });
  });

  describe('one-shot stop point', () => {
    it('stops there and beats looping', () => {
      const r = run({ timeMs: 1990, deltaMs: 20, stopAtMs: 2000, loop: true });
      expect(r.timeMs).toBe(2000);
      expect(r.stop).toBe(true);
    });

    it('does not fire before it is reached', () => {
      const r = run({ timeMs: 1000, stopAtMs: 2000 });
      expect(r.stop).toBe(false);
    });

    it('works in reverse', () => {
      const r = run({ timeMs: 1010, rate: -1, deltaMs: 20, stopAtMs: 1000 });
      expect(r.timeMs).toBe(1000);
      expect(r.stop).toBe(true);
    });
  });

  it('never overshoots the boundary at high shuttle rates', () => {
    // 8x with a capped 100ms delta covers 800ms — well past the end from here.
    const r = run({ timeMs: 4900, rate: 8, deltaMs: 100 });
    expect(r.timeMs).toBe(5000);
    expect(r.stop).toBe(true);
  });

  it('keeps a high-rate loop wrap inside the range', () => {
    const r = run({ timeMs: 4900, rate: 8, deltaMs: 100, loop: true });
    expect(r.timeMs).toBeGreaterThanOrEqual(0);
    expect(r.timeMs).toBeLessThanOrEqual(5000);
    expect(r.stop).toBe(false);
  });
});

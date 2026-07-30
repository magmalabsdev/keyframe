import { describe, it, expect } from 'vitest';
import { computePeaks, resamplePeaks } from './waveform';

describe('computePeaks', () => {
  it('finds the min/max of a ramp signal', () => {
    const ch = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const { mins, maxs } = computePeaks([ch], 1);
    expect(mins[0]).toBe(-1);
    expect(maxs[0]).toBe(1);
  });

  it('splits samples across buckets in order', () => {
    const ch = new Float32Array([0, 0.2, 0.9, -0.9, -0.2, 0]);
    const { mins, maxs } = computePeaks([ch], 2);
    // bucket 0: indices 0-2 (0, 0.2, 0.9); bucket 1: indices 3-5 (-0.9, -0.2, 0)
    expect(maxs[0]).toBeCloseTo(0.9);
    expect(mins[0]).toBeCloseTo(0);
    expect(mins[1]).toBeCloseTo(-0.9);
    expect(maxs[1]).toBeCloseTo(0);
  });

  it('takes the union across channels rather than averaging', () => {
    // Two out-of-phase channels: averaging would cancel to ~0, but the union
    // must preserve each channel's own extremes.
    const left = new Float32Array([1, 1, 1]);
    const right = new Float32Array([-1, -1, -1]);
    const { mins, maxs } = computePeaks([left, right], 1);
    expect(maxs[0]).toBe(1);
    expect(mins[0]).toBe(-1);
  });

  it('handles more buckets than samples without crashing', () => {
    const ch = new Float32Array([0.5, -0.5]);
    const { mins, maxs } = computePeaks([ch], 10);
    expect(mins.length).toBe(10);
    expect(maxs.length).toBe(10);
  });

  it('returns all-zero peaks for silence', () => {
    const ch = new Float32Array(100);
    const { mins, maxs } = computePeaks([ch], 4);
    expect([...mins]).toEqual([0, 0, 0, 0]);
    expect([...maxs]).toEqual([0, 0, 0, 0]);
  });

  it('handles zero buckets and empty channel data', () => {
    expect(computePeaks([new Float32Array([1, 2, 3])], 0).mins.length).toBe(0);
    expect(computePeaks([new Float32Array(0)], 4).mins.length).toBe(4);
  });
});

describe('resamplePeaks', () => {
  const mins = new Float32Array([-1, -0.5, -0.2, -0.8, -0.1]);
  const maxs = new Float32Array([1, 0.5, 0.2, 0.8, 0.1]);

  it('identity resample (full range, same width) reproduces the source', () => {
    const out = resamplePeaks(mins, maxs, 0, 5, 5);
    expect([...out.mins]).toEqual([...mins]);
    expect([...out.maxs]).toEqual([...maxs]);
  });

  it('downsamples by taking the min/max across merged buckets', () => {
    const out = resamplePeaks(mins, maxs, 0, 5, 1);
    expect(out.maxs[0]).toBe(1);
    expect(out.mins[0]).toBe(-1);
  });

  it('upsamples (more output columns than source buckets)', () => {
    const out = resamplePeaks(mins, maxs, 0, 5, 10);
    expect(out.mins.length).toBe(10);
    expect(out.maxs.length).toBe(10);
  });

  it('slices a fractional bucket range (a mid-clip trim window)', () => {
    // A trim window covering only buckets [1, 3) — the middle two values.
    const out = resamplePeaks(mins, maxs, 1, 3, 2);
    expect(out.maxs[0]).toBeCloseTo(0.5);
    expect(out.maxs[1]).toBeCloseTo(0.2);
  });
});

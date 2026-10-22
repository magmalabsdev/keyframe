import { describe, it, expect } from 'vitest';
import { gainAt, hasGainKeyframes, sampleGainCurve } from './gainAutomation';
import type { AudioClip } from '../state/types';

function clip(partial: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'c',
    name: 'c',
    mediaId: 'm',
    startMs: 0,
    offsetMs: 0,
    durationMs: 1000,
    sourceDurationMs: 1000,
    gain: 0.5,
    loop: false,
    ...partial,
  };
}

const kf = (timeMs: number, value: number) => ({
  id: `k${timeMs}`,
  timeMs,
  value,
  interpolation: 'linear' as const,
});

describe('hasGainKeyframes', () => {
  it('is false with no gainTrack or an empty one', () => {
    expect(hasGainKeyframes(clip())).toBe(false);
    expect(hasGainKeyframes(clip({ gainTrack: [] }))).toBe(false);
  });

  it('is true once a keyframe exists', () => {
    expect(hasGainKeyframes(clip({ gainTrack: [kf(0, 1)] }))).toBe(true);
  });
});

describe('gainAt', () => {
  it('is 0 when muted, regardless of gain or keyframes', () => {
    expect(gainAt(clip({ gain: 1 }), true, 0)).toBe(0);
    expect(gainAt(clip({ gainTrack: [kf(0, 1)] }), true, 0)).toBe(0);
  });

  it('falls back to the constant gain with no keyframes', () => {
    expect(gainAt(clip({ gain: 0.7 }), false, 500)).toBe(0.7);
  });

  it('interpolates between keyframes', () => {
    const c = clip({ gainTrack: [kf(0, 0), kf(1000, 1)] });
    expect(gainAt(c, false, 0)).toBe(0);
    expect(gainAt(c, false, 500)).toBeCloseTo(0.5, 9);
    expect(gainAt(c, false, 1000)).toBe(1);
  });

  it('holds the edge values outside the keyframe range', () => {
    const c = clip({ gainTrack: [kf(200, 0.2), kf(800, 0.8)] });
    expect(gainAt(c, false, 0)).toBe(0.2);
    expect(gainAt(c, false, 1000)).toBe(0.8);
  });
});

describe('sampleGainCurve', () => {
  it('samples forward (increasing time) matching gainAt at the endpoints', () => {
    const c = clip({ gainTrack: [kf(0, 0), kf(1000, 1)] });
    const curve = sampleGainCurve(c, false, 0, 1000);
    expect(curve[0]).toBeCloseTo(gainAt(c, false, 0), 6);
    expect(curve[curve.length - 1]).toBeCloseTo(gainAt(c, false, 1000), 6);
    // Monotonically increasing, matching the linear ramp.
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });

  it('samples backward (decreasing time) for reverse playback', () => {
    const c = clip({ gainTrack: [kf(0, 0), kf(1000, 1)] });
    const curve = sampleGainCurve(c, false, 1000, 0);
    expect(curve[0]).toBeCloseTo(1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 6);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
  });

  it('applies muting to every sample', () => {
    const c = clip({ gainTrack: [kf(0, 0), kf(1000, 1)] });
    const curve = sampleGainCurve(c, true, 0, 1000);
    expect([...curve].every((v) => v === 0)).toBe(true);
  });

  it('respects maxSamples/minStepMs bounds and never returns fewer than 2 samples', () => {
    const c = clip({ gainTrack: [kf(0, 0), kf(10, 1)] });
    const curve = sampleGainCurve(c, false, 0, 10, { minStepMs: 5 });
    expect(curve.length).toBeGreaterThanOrEqual(2);
    expect(curve.length).toBeLessThanOrEqual(10 / 5 + 2);
  });

  it('handles a zero-span request without NaN', () => {
    const c = clip({ gainTrack: [kf(0, 0.5)] });
    const curve = sampleGainCurve(c, false, 500, 500);
    expect(curve.length).toBeGreaterThanOrEqual(2);
    expect([...curve].every((v) => !Number.isNaN(v))).toBe(true);
  });
});

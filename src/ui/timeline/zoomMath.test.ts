import { describe, it, expect } from 'vitest';
import { clampViewStart, computeZoomViewStart, formatTickLabel, tickStepMs } from './zoomMath';

describe('computeZoomViewStart', () => {
  it('keeps the cursor time fixed on screen across a zoom change', () => {
    const pxPerMs = 0.1;
    const viewStart = 500;
    const clientOffsetPx = 200;
    const cursorMs = viewStart + clientOffsetPx / pxPerMs; // 2500

    const nextPxPerMs = 0.4;
    const nextViewStart = computeZoomViewStart(cursorMs, nextPxPerMs, clientOffsetPx);
    // Re-deriving the time under the same offset with the new state should
    // reproduce cursorMs exactly.
    const reconstructed = nextViewStart + clientOffsetPx / nextPxPerMs;
    expect(reconstructed).toBeCloseTo(cursorMs, 9);
  });
});

describe('clampViewStart', () => {
  it('floors at 0', () => {
    expect(clampViewStart(-500, 1, 1000, 10000)).toBe(0);
  });

  it('caps so the visible window never exceeds the scene duration', () => {
    // pxPerMs=1, containerWidth=1000 => visibleMs=1000; duration=5000 => max viewStart=4000
    expect(clampViewStart(9000, 1, 1000, 5000)).toBe(4000);
  });

  it('passes through an in-range value unchanged', () => {
    expect(clampViewStart(2000, 1, 1000, 5000)).toBe(2000);
  });

  it('clamps to 0 when the visible window already covers the whole duration', () => {
    expect(clampViewStart(500, 1, 2000, 1000)).toBe(0);
  });
});

describe('tickStepMs', () => {
  it('picks a "nice" step close to the target pixel spacing', () => {
    // At pxPerMs=1, targetPx=90 => targetMs=90 => nearest nice step >=90 is 100.
    expect(tickStepMs(1, 90)).toBe(100);
  });

  it('scales down for a denser zoom level', () => {
    // pxPerMs=10 => targetMs=9 => nearest nice step >=9 is 10.
    expect(tickStepMs(10, 90)).toBe(10);
  });

  it('scales up for a sparse zoom level', () => {
    // pxPerMs=0.01 => targetMs=9000 => nearest nice step >=9000 is 10000.
    expect(tickStepMs(0.01, 90)).toBe(10000);
  });

  it('always returns one of the 1/2/5/10 * 10^n family', () => {
    for (const pxPerMs of [0.02, 0.3, 1, 7, 50]) {
      const step = tickStepMs(pxPerMs);
      const pow = Math.pow(10, Math.floor(Math.log10(step)));
      const mantissa = Math.round(step / pow);
      expect([1, 2, 5, 10]).toContain(mantissa);
    }
  });
});

describe('formatTickLabel', () => {
  it('shows whole seconds when the step is a full second or more', () => {
    expect(formatTickLabel(12000, 1000)).toBe('12s');
    expect(formatTickLabel(12000, 5000)).toBe('12s');
  });

  it('shows tenths when the step is 100-999ms', () => {
    expect(formatTickLabel(1200, 200)).toBe('1.2s');
  });

  it('shows hundredths when the step is 10-99ms', () => {
    expect(formatTickLabel(1230, 10)).toBe('1.23s');
  });

  it('shows thousandths when the step is under 10ms', () => {
    expect(formatTickLabel(1234, 2)).toBe('1.234s');
  });

  it('gives adjacent ticks distinguishable labels at every step size', () => {
    for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
      expect(formatTickLabel(step, step)).not.toBe(formatTickLabel(0, step));
    }
  });
});

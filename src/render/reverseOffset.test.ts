import { describe, it, expect } from 'vitest';
import { reversedBufferOffsetSec } from './reverseOffset';

describe('reversedBufferOffsetSec', () => {
  it('for an untrimmed clip, maps the clip start to the end of the reversed buffer', () => {
    const clip = { startMs: 0, offsetMs: 0 };
    expect(reversedBufferOffsetSec(clip, 0, 5000)).toBeCloseTo(5);
  });

  it('for an untrimmed clip, maps the clip end to the start of the reversed buffer', () => {
    const clip = { startMs: 0, offsetMs: 0 };
    expect(reversedBufferOffsetSec(clip, 5000, 5000)).toBeCloseTo(0);
  });

  it('accounts for a trimmed clip (non-zero offsetMs and startMs)', () => {
    // Source is 10s; clip trims in 2s (offsetMs=2000) and starts at timeline
    // 3000ms. At timeline fromMs=4000, we're 1s into the trimmed content, so
    // source position = 2000 + 1000 = 3000ms; reversed offset = 10000-3000 = 7000ms.
    const clip = { startMs: 3000, offsetMs: 2000 };
    expect(reversedBufferOffsetSec(clip, 4000, 10000)).toBeCloseTo(7);
  });

  it('clamps at the clip-start boundary', () => {
    const clip = { startMs: 1000, offsetMs: 500 };
    // fromMs === clip.startMs -> sourcePosMs = offsetMs = 500 -> reversed = 9500ms
    expect(reversedBufferOffsetSec(clip, 1000, 10000)).toBeCloseTo(9.5);
  });

  it('clamps to the buffer range when fromMs falls outside the clip window', () => {
    const clip = { startMs: 0, offsetMs: 0 };
    // Far past the source's duration -> clamp to 0, not negative.
    expect(reversedBufferOffsetSec(clip, 20000, 5000)).toBe(0);
    // Before the clip start -> clamp to sourceDurationMs, not beyond.
    expect(reversedBufferOffsetSec(clip, -1000, 5000)).toBe(5);
  });
});

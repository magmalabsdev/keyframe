/**
 * Pure overlap resolution for audio clips on one track.
 *
 * Invariant this module enforces: clips on a track never overlap under
 * half-open semantics, so butt-joined clips (one ending exactly where the next
 * begins) are legal. Overlaps used to be allowed, and the audio engine gives
 * every clip its own voice — so two overlapping clips played the same source at
 * two different offsets simultaneously, which is what made timing sound
 * unpredictable after moving clips around.
 *
 * Policy is overwrite (as in Premiere/Resolve): the moved clip wins, and
 * whatever it lands on is trimmed, removed, or split. Kept free of stores,
 * immer, and `nanoid` so it is deterministic and directly testable.
 */
import type { AudioClip } from './types';

/** Fragments shorter than this are discarded rather than left as slivers. */
export const MIN_FRAGMENT_MS = 1;

export interface ClipEdit {
  id: string;
  startMs: number;
  offsetMs: number;
  durationMs: number;
}

export interface ClipInsert {
  /** Clip this fragment is cloned from; the caller supplies the fresh id. */
  sourceId: string;
  startMs: number;
  offsetMs: number;
  durationMs: number;
}

export interface OverlapResolution {
  removeIds: string[];
  updates: ClipEdit[];
  inserts: ClipInsert[];
}

/** Half-open overlap test: butt-joined ranges do NOT overlap. */
export function clipsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Trim-in for a clip whose left edge advances by `delta`, so the audible
 * content stays put under the surviving part.
 *
 * No source-length clamp is needed for the non-loop case: the new pair
 * satisfies `newOffset + newDuration === offsetMs + (cEnd - cStart)`, which is
 * already within the source for any valid clip. A looping clip wraps, which
 * preserves its audible phase.
 */
function advanceOffset(clip: AudioClip, delta: number): number {
  return clip.loop
    ? (clip.offsetMs + delta) % Math.max(1, clip.sourceDurationMs)
    : clip.offsetMs + delta;
}

/**
 * Overwrite semantics: `moved` wins, and every clip in `others` is trimmed,
 * removed, or split so nothing overlaps it. `others` should be the track's
 * other clips (sorted by `startMs`, as the store always keeps them).
 */
export function resolveOverlaps(
  moved: { id: string; startMs: number; durationMs: number },
  others: readonly AudioClip[],
  opts?: { minFragmentMs?: number },
): OverlapResolution {
  const minFragment = opts?.minFragmentMs ?? MIN_FRAGMENT_MS;
  const res: OverlapResolution = { removeIds: [], updates: [], inserts: [] };

  const mStart = moved.startMs;
  const mEnd = mStart + moved.durationMs;

  for (const c of others) {
    if (c.id === moved.id) continue;
    const cStart = c.startMs;
    const cEnd = cStart + c.durationMs;
    // `others` is sorted, so nothing past the moved clip's end can overlap.
    if (cStart >= mEnd) break;
    if (!clipsOverlap(mStart, mEnd, cStart, cEnd)) continue;

    // Fully covered.
    if (mStart <= cStart && cEnd <= mEnd) {
      res.removeIds.push(c.id);
      continue;
    }

    // Landed strictly inside: the incumbent splits in two.
    if (cStart < mStart && mEnd < cEnd) {
      const leftDur = mStart - cStart;
      const rightDur = cEnd - mEnd;
      // Trimming the tail never moves the trim-in, so offsetMs is unchanged.
      if (leftDur >= minFragment) {
        res.updates.push({
          id: c.id,
          startMs: cStart,
          offsetMs: c.offsetMs,
          durationMs: leftDur,
        });
      } else {
        res.removeIds.push(c.id);
      }
      if (rightDur >= minFragment) {
        res.inserts.push({
          sourceId: c.id,
          startMs: mEnd,
          offsetMs: advanceOffset(c, mEnd - cStart),
          durationMs: rightDur,
        });
      }
      continue;
    }

    // Incumbent starts before the moved clip and ends inside it: keep the head.
    if (cStart < mStart) {
      const dur = mStart - cStart;
      if (dur >= minFragment) {
        res.updates.push({ id: c.id, startMs: cStart, offsetMs: c.offsetMs, durationMs: dur });
      } else {
        res.removeIds.push(c.id);
      }
      continue;
    }

    // Incumbent starts inside the moved clip and ends after it: keep the tail.
    const dur = cEnd - mEnd;
    if (dur >= minFragment) {
      res.updates.push({
        id: c.id,
        startMs: mEnd,
        offsetMs: advanceOffset(c, mEnd - cStart),
        durationMs: dur,
      });
    } else {
      res.removeIds.push(c.id);
    }
  }

  return res;
}

/**
 * Heals a track that already contains overlaps (documents saved before the
 * invariant existed). Left-to-right, earlier clip wins: each clip is trimmed
 * to start no earlier than the previous clip's end, or dropped if nothing of
 * it survives.
 */
export function normalizeAudioOverlaps(clips: AudioClip[]): AudioClip[] {
  const sorted = [...clips].sort((a, b) => a.startMs - b.startMs);
  const out: AudioClip[] = [];
  let prevEnd = -Infinity;
  for (const c of sorted) {
    const cEnd = c.startMs + c.durationMs;
    if (cEnd <= prevEnd) continue; // wholly swallowed by an earlier clip
    if (c.startMs < prevEnd) {
      const delta = prevEnd - c.startMs;
      const durationMs = c.durationMs - delta;
      if (durationMs < MIN_FRAGMENT_MS) continue;
      out.push({
        ...c,
        startMs: prevEnd,
        offsetMs: advanceOffset(c, delta),
        durationMs,
      });
      prevEnd = prevEnd + durationMs;
      continue;
    }
    out.push(c);
    prevEnd = cEnd;
  }
  return out;
}

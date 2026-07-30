/**
 * Pure lane-packing for the timeline's object rows (a video-editor track
 * layout): objects whose lifetimes don't overlap share a lane; overlapping
 * ones split into separate lanes. Kept free of React/store code so it's
 * directly testable.
 */
import { childrenOf } from '../../scene/tree';
import type { SceneObject } from '../../state/types';

/**
 * Packs objects into lanes. `laneMemory` remembers each object's lane across
 * calls (keyed by object id) so that dragging one clip never reshuffles where
 * unrelated clips sit — only a clip whose own lifetime now genuinely
 * conflicts with its remembered lane's occupant gets moved to a new one.
 *
 * Two phases, both processed in the given (lifetime-independent) object
 * order so a drag changing one object's startMs can't change how OTHER
 * objects resolve conflicts among themselves:
 *  1. For each lane any object currently remembers, keep as many of its
 *     claimants as possible without them overlapping each other (first
 *     claimant in array order wins a conflict; the loser falls to phase 2).
 *  2. Place every remaining (orphaned or memory-less) object via first-fit
 *     against the lane-end state phase 1 already established, so an orphan
 *     can never steal a lane an incumbent still legitimately holds.
 *
 * Finally, whatever raw lane numbers ended up in use are compacted to a
 * contiguous 0..N-1 range (preserving relative order) so stale lane numbers
 * left behind by long-deleted objects don't leave permanent blank rows.
 */
export function packLanes(
  objects: SceneObject[],
  laneMemory: Map<string, number>,
): SceneObject[][] {
  const byLane = new Map<number, SceneObject[]>();
  for (const o of objects) {
    const lane = laneMemory.get(o.id);
    if (lane == null) continue;
    const group = byLane.get(lane);
    if (group) group.push(o);
    else byLane.set(lane, [o]);
  }

  const rawLaneOf = new Map<string, number>();
  const laneEnd = new Map<number, number>();
  for (const [lane, group] of byLane) {
    let lastEnd = -Infinity;
    for (const o of group) {
      if (o.lifetime.startMs >= lastEnd) {
        rawLaneOf.set(o.id, lane);
        lastEnd = o.lifetime.endMs;
        laneEnd.set(lane, Math.max(laneEnd.get(lane) ?? 0, o.lifetime.endMs));
      }
    }
  }

  for (const o of objects) {
    if (rawLaneOf.has(o.id)) continue;
    let idx = 0;
    while ((laneEnd.get(idx) ?? 0) > o.lifetime.startMs) idx++;
    rawLaneOf.set(o.id, idx);
    laneEnd.set(idx, o.lifetime.endMs);
  }

  const usedRaw = [...new Set(rawLaneOf.values())].sort((a, b) => a - b);
  const compact = new Map(usedRaw.map((raw, i) => [raw, i]));

  const lanes: SceneObject[][] = usedRaw.map(() => []);
  for (const o of objects) {
    const idx = compact.get(rawLaneOf.get(o.id)!)!;
    lanes[idx].push(o);
    laneMemory.set(o.id, idx);
  }
  return lanes;
}

export interface ObjRow {
  key: string;
  label?: string;
  head?: boolean;
  depth: number;
  clips: SceneObject[];
}

/**
 * Builds the object-lane rows: top-level objects packed into lanes, with each
 * expanded group's children packed into indented lanes inserted beneath the
 * lane the group sits on (drill-in). Groups count as one clip.
 */
export function buildObjectRows(
  objects: SceneObject[],
  expanded: Set<string>,
  laneMemory: Map<string, number>,
): ObjRow[] {
  // Drop remembered lanes for deleted objects so the map doesn't grow unbounded.
  const liveIds = new Set(objects.map((o) => o.id));
  for (const id of laneMemory.keys()) {
    if (!liveIds.has(id)) laneMemory.delete(id);
  }

  const rows: ObjRow[] = [];
  const visit = (parentId: string | null, depth: number, headerLabel: string) => {
    const kids = childrenOf(objects, parentId);
    if (kids.length === 0) return;
    packLanes(kids, laneMemory).forEach((lane, li) => {
      rows.push({
        key: `obj-${parentId ?? 'root'}-${li}`,
        label: li === 0 ? headerLabel : undefined,
        head: parentId === null && li === 0,
        depth,
        clips: lane,
      });
      for (const obj of lane) {
        if (expanded.has(obj.id) && childrenOf(objects, obj.id).length > 0) {
          visit(obj.id, depth + 1, obj.name);
        }
      }
    });
  };
  visit(null, 0, 'Objects');
  return rows;
}

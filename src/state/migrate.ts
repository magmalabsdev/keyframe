import { nanoid } from 'nanoid';
import type { ChannelKey, Project, SceneObject, Tracks, ValueKeyframe } from './types';
import { buildGeometry, putGeometry, putGeometryData } from '../io/geometryCache';

/** Legacy asset shape: geometry stored inline as number[] (pre out-of-store). */
interface LegacyGeometryData {
  positions: number[] | Float32Array;
  normals?: number[] | Float32Array;
  index?: number[] | Uint32Array;
}

/**
 * Migrates a loaded project in place to the current document model:
 *  - ensures `variables` / `bindings` exist (v1 -> v2),
 *  - converts legacy whole-pose `SceneObject.keyframes` into per-channel `tracks`,
 *  - moves legacy in-project `asset.geometry` out into the geometry caches as
 *    typed arrays (geometry no longer lives in the document store).
 *
 * Idempotent: already-migrated data is left untouched.
 */
export function migrateProject(project: Project): Project {
  project.variables ??= [];
  project.bindings ??= {};
  for (const asset of Object.values(project.assets) as Array<
    { id: string; geometry?: LegacyGeometryData }
  >) {
    if (!asset.geometry) continue;
    const g = asset.geometry;
    const data = {
      positions: g.positions instanceof Float32Array ? g.positions : Float32Array.from(g.positions),
      normals: g.normals
        ? g.normals instanceof Float32Array
          ? g.normals
          : Float32Array.from(g.normals)
        : undefined,
      index: g.index
        ? g.index instanceof Uint32Array
          ? g.index
          : Uint32Array.from(g.index)
        : undefined,
    };
    putGeometryData(asset.id, data);
    putGeometry(asset.id, buildGeometry(data));
    delete asset.geometry; // geometry no longer belongs in the document store
  }
  for (const scene of project.scenes) {
    for (const obj of scene.objects) migrateObject(obj);
  }
  return project;
}

function migrateObject(obj: SceneObject): void {
  if (!obj.tracks) obj.tracks = {};
  const legacy = obj.keyframes;
  if (!legacy || legacy.length === 0) {
    delete obj.keyframes;
    return;
  }

  const tracks: Tracks = obj.tracks;
  const push = (channel: ChannelKey, kf: ValueKeyframe) => {
    (tracks[channel] ??= []).push(kf);
  };

  for (const k of legacy) {
    const axes: [ChannelKey, number][] = [
      ['position.0', k.position[0]],
      ['position.1', k.position[1]],
      ['position.2', k.position[2]],
      ['rotation.0', k.rotation[0]],
      ['rotation.1', k.rotation[1]],
      ['rotation.2', k.rotation[2]],
      ['scale.0', k.scale[0]],
      ['scale.1', k.scale[1]],
      ['scale.2', k.scale[2]],
    ];
    for (const [channel, value] of axes) {
      push(channel, { id: nanoid(), timeMs: k.timeMs, value, interpolation: k.interpolation });
    }
    if (k.color != null) {
      push('color', {
        id: nanoid(),
        timeMs: k.timeMs,
        value: k.color,
        interpolation: k.interpolation,
      });
    }
  }
  for (const key of Object.keys(tracks) as ChannelKey[]) {
    tracks[key]!.sort((a, b) => a.timeMs - b.timeMs);
  }
  delete obj.keyframes;
}

import { nanoid } from 'nanoid';
import {
  DOCUMENT_VERSION,
  type ChannelKey,
  type Project,
  type Scene,
  type SceneObject,
  type Tracks,
  type ValueKeyframe,
} from './types';
import {
  createLightObject,
  defaultSurfaceParams,
  defaultTextParams,
  DEFAULT_AMBIENT_INTENSITY,
  DEFAULT_FPS,
} from './defaults';
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
 *  - injects a default light into unlit scenes (v2 -> v3: scenes were
 *    previously lit by built-in viewport lights, which no longer exist),
 *  - converts legacy whole-pose `SceneObject.keyframes` and `Scene.camera.keyframes`
 *    into per-channel `tracks`,
 *  - moves legacy in-project `asset.geometry` out into the geometry caches as
 *    typed arrays (geometry no longer lives in the document store),
 *  - backfills surface params and repairs degenerate polygons (v3 -> v4),
 *  - ensures each scene has an `audioTracks` array (v4 -> v5),
 *  - backfills text/glyph params and clamps write-on values (v5 -> v6),
 *  - backfills the ambient fill-light and frame-rate settings on every scene.
 *
 * Idempotent: already-migrated data is left untouched. The light injection is
 * version-gated (not presence-based) so a light the user deleted from a v3+
 * document stays deleted on reload.
 */
export function migrateProject(project: Project): Project {
  project.variables ??= [];
  project.bindings ??= {};
  // v4 -> v5: audio tracks. Presence-based backfill so older files load.
  for (const scene of project.scenes) scene.audioTracks ??= [];
  for (const scene of project.scenes) scene.markers ??= [];
  // Ambient fill light. Presence-based (not version-gated) and `??=` so a
  // scene deliberately dialed to 0 stays at 0 across reloads.
  for (const scene of project.scenes) {
    scene.settings.ambientIntensity ??= DEFAULT_AMBIENT_INTENSITY;
    scene.settings.fps ??= DEFAULT_FPS;
  }
  if ((project.version ?? 1) < 3) {
    for (const scene of project.scenes) {
      const hasEmitter = scene.objects.some(
        (o) => o.type === 'light' || o.light?.enabled,
      );
      if (!hasEmitter) scene.objects.push(createLightObject(scene.durationMs));
    }
  }
  project.version = DOCUMENT_VERSION;
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
    migrateCamera(scene);
  }
  return project;
}

/**
 * Backfills surface params. Not version-gated: a hand-edited or partially
 * written file can carry a 'surface' object with a missing or degenerate
 * polygon, which would throw during triangulation.
 */
function migrateSurface(obj: SceneObject): void {
  if (obj.type !== 'surface') return;
  obj.surface = { ...defaultSurfaceParams(), ...(obj.surface ?? {}) };
  if (!Array.isArray(obj.surface.points) || obj.surface.points.length < 3) {
    obj.surface.points = defaultSurfaceParams().points;
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Backfills text-object params (v5 -> v6, presence-based like surfaces).
 * Also clamps write-on values that a hand-edited file may carry out of range.
 */
function migrateText(obj: SceneObject): void {
  if (obj.type === 'text') {
    obj.text = { ...defaultTextParams(), ...(obj.text ?? {}) };
    if (obj.text.writeOn != null) obj.text.writeOn = clamp01(obj.text.writeOn);
  }
  if (obj.type === 'glyph') {
    obj.glyph ??= { char: '?', index: 0, layoutPos: [0, 0, 0] };
    obj.glyph.layoutPos ??= [0, 0, 0];
  }
  if (obj.surface?.writeOn != null) obj.surface.writeOn = clamp01(obj.surface.writeOn);
}

/** Converts legacy whole-pose `Scene.camera.keyframes` into per-axis `tracks`. */
function migrateCamera(scene: Scene): void {
  if (!scene.camera.tracks) scene.camera.tracks = {};
  const legacy = scene.camera.keyframes;
  if (!legacy || legacy.length === 0) {
    delete scene.camera.keyframes;
    return;
  }

  const tracks: Tracks = scene.camera.tracks;
  const push = (channel: ChannelKey, kf: ValueKeyframe) => {
    (tracks[channel] ??= []).push(kf);
  };

  for (const k of legacy) {
    const axes: [ChannelKey, number][] = [
      ['position.0', k.position[0]],
      ['position.1', k.position[1]],
      ['position.2', k.position[2]],
      ['target.0', k.target[0]],
      ['target.1', k.target[1]],
      ['target.2', k.target[2]],
    ];
    for (const [channel, value] of axes) {
      push(channel, { id: nanoid(), timeMs: k.timeMs, value, interpolation: k.interpolation });
    }
  }
  for (const key of Object.keys(tracks) as ChannelKey[]) {
    tracks[key]!.sort((a, b) => a.timeMs - b.timeMs);
  }
  delete scene.camera.keyframes;
}

function migrateObject(obj: SceneObject): void {
  if (!obj.tracks) obj.tracks = {};
  migrateSurface(obj);
  migrateText(obj);
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

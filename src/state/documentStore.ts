import { create } from 'zustand';
import { useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { nanoid } from 'nanoid';
import { current } from 'immer';
import { createDefaultProject, createDefaultScene } from './defaults';
import type {
  Asset,
  CameraState,
  ChannelKey,
  Easing,
  IdleAnimation,
  Lifetime,
  Material,
  MediaAsset,
  Project,
  Scene,
  SceneObject,
  SceneSettings,
  Transform,
  Transition,
  ValueKeyframe,
  Vec3,
} from './types';
import { defaultIdle, defaultTransition, TIME_VARIABLE } from './types';
import { evaluateExpr, renameIdentifier, varsMap } from './expr';
import { recomputeBindings, writeBoundValue } from './bindings';
import { migrateProject } from './migrate';
import { evaluateObject } from '../animation/evaluate';
import { disposeGeometry } from '../io/geometryCache';
import { resolveVariables, wouldCreateCycle } from '../animation/variables';
import { useEditorStore } from './editorStore';

/** Two keyframes within this many ms are treated as the same time slot. */
const KEYFRAME_EPSILON = 1;

export interface DocumentState {
  project: Project;
  /** Replace the entire project (used by load / import). */
  setProject: (project: Project) => void;
  setProjectName: (name: string) => void;
  setActiveScene: (sceneId: string) => void;

  /** Add an imported geometry asset + its scene object to the active scene. */
  addImportedModel: (asset: Asset, object: SceneObject) => void;
  /** Add several imported assets + objects in one update (multi-part files). */
  addImportedModels: (assets: Asset[], objects: SceneObject[]) => void;
  /** Register an uploaded image/gif/video asset's metadata. */
  addMediaAsset: (asset: MediaAsset) => void;
  /** Add already-built objects (e.g. from paste) to the active scene. */
  addObjects: (objects: SceneObject[]) => void;
  removeObjects: (ids: string[]) => void;
  setObjectName: (id: string, name: string) => void;
  setObjectVisible: (id: string, visible: boolean) => void;

  /** Replace an object's full transform (used by gizmo commit). */
  setObjectTransform: (id: string, transform: Transform) => void;
  /** Merge a partial transform (used by inspector fields). */
  patchObjectTransform: (id: string, patch: Partial<Transform>) => void;
  setObjectMaterial: (id: string, patch: Partial<Material>) => void;
  setObjectIdle: (id: string, patch: Partial<IdleAnimation>) => void;
  setObjectTransition: (
    id: string,
    which: 'start' | 'end',
    patch: Partial<Transition>,
  ) => void;
  setObjectCenterOfRotation: (id: string, center: Vec3) => void;

  /** Batch edits across several objects in one undo step (multi-select). */
  patchObjectsTransform: (ids: string[], patch: Partial<Transform>) => void;
  /** Set one transform component (position/rotation/scale × axis) on many objects,
   * preserving each object's other components. */
  setObjectsTransformComponent: (
    ids: string[],
    field: 'position' | 'rotation' | 'scale',
    axis: 0 | 1 | 2,
    value: number,
  ) => void;
  setObjectsMaterial: (ids: string[], patch: Partial<Material>) => void;
  setObjectsVisible: (ids: string[], visible: boolean) => void;

  /** Create a group and reparent children into it (one undo step). */
  groupObjects: (
    group: SceneObject,
    childIds: string[],
    localPositions: Record<string, [number, number, number]>,
  ) => void;
  /** Dissolve a group, applying baked child transforms (one undo step). */
  ungroupObjects: (
    groupId: string,
    childUpdates: { id: string; parentId: string | null; transform: Transform }[],
  ) => void;

  setSceneName: (name: string) => void;
  setSceneDuration: (durationMs: number) => void;
  patchSceneSettings: (patch: Partial<SceneSettings>) => void;

  addScene: () => void;
  removeScene: (sceneId: string) => void;
  renameScene: (sceneId: string, name: string) => void;
  duplicateScene: () => void;

  /** Remap an object's keyframe times when its lifetime is resized. */
  remapKeyframeTimes: (
    objectId: string,
    oldRange: Lifetime,
    newRange: Lifetime,
    mode: 'boundary' | 'scale',
  ) => void;

  /**
   * Cycle the keyframe mode of one value channel at a time. A channel key is
   * either `object:<id>:<channel>:<axis>` / `object:<id>:opacity|color`, or
   * `var:<id>` for a variable. Cycles: none -> linear -> easeIn -> easeOut ->
   * easeInOut -> step -> none (removed).
   */
  cycleKeyframe: (channelKey: string, timeMs: number) => void;
  /** Auto-key: set/insert a channel keyframe's value at a time (linear if new). */
  setChannelKeyframeValue: (
    channelKey: string,
    timeMs: number,
    value: number | string,
  ) => void;
  /** Move a single channel keyframe (by id) to a new time. */
  moveChannelKeyframe: (channelKey: string, kfId: string, timeMs: number) => void;
  /** Move every channel keyframe of an object at `fromMs` (±epsilon) to `toMs`. */
  moveKeyframesAtTime: (objectId: string, fromMs: number, toMs: number) => void;
  /** Delete every channel keyframe of an object at a given time (±epsilon). */
  deleteKeyframesAtTime: (objectId: string, timeMs: number) => void;
  setObjectLifetime: (objectId: string, lifetime: Lifetime) => void;

  upsertCameraKeyframe: (
    timeMs: number,
    state: CameraState,
    interpolation?: Easing,
  ) => void;
  removeCameraKeyframe: (keyframeId: string) => void;

  /** Project-global variables (live-bound numeric fields). */
  addVariable: () => void;
  setVariableName: (id: string, name: string) => void;
  setVariableValue: (id: string, value: number) => void;
  /** Set a variable's expression ('' clears it). Rejected if it would cycle. */
  setVariableExpr: (id: string, expr: string) => void;
  removeVariable: (id: string) => void;
  /** Bind a numeric field (by path key) to an expression; '' clears it. */
  setBinding: (key: string, expr: string) => void;
  clearBinding: (key: string) => void;
}

function activeSceneDraft(project: Project): Scene {
  return (
    project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0]
  );
}

function findObject(project: Project, id: string): SceneObject | undefined {
  return activeSceneDraft(project).objects.find((o) => o.id === id);
}

/** Interpolation modes the per-value diamond cycles through, in order. */
const EASE_ORDER: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];

/** Resolves a keyframe channel key to its track array + how to read its value. */
function resolveChannel(
  project: Project,
  channelKey: string,
):
  | { track: ValueKeyframe[]; currentValue: () => number | string }
  | undefined {
  const parts = channelKey.split(':');
  if (parts[0] === 'var') {
    const v = project.variables.find((x) => x.id === parts[1]);
    if (!v) return undefined;
    v.track ??= [];
    return {
      track: v.track,
      currentValue: () => resolveVariables(project, useEditorStore.getState().playheadMs)[v.name] ?? v.value,
    };
  }
  if (parts[0] === 'object') {
    const obj = findObject(project, parts[1]);
    if (!obj) return undefined;
    const channel = (parts.length === 4 ? `${parts[2]}.${parts[3]}` : parts[2]) as ChannelKey;
    obj.tracks ??= {};
    obj.tracks[channel] ??= [];
    return {
      track: obj.tracks[channel]!,
      currentValue: () => {
        const time = useEditorStore.getState().playheadMs;
        const pose = evaluateObject(obj, time);
        if (channel === 'color') return pose.color;
        if (channel === 'opacity') return pose.opacity;
        const [name, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', string];
        return pose[name][Number(axis)];
      },
    };
  }
  return undefined;
}

/** Removes empty channel tracks from an object so it reads as un-animated. */
function pruneEmptyTracks(project: Project, channelKey: string): void {
  const parts = channelKey.split(':');
  if (parts[0] !== 'object') return;
  const obj = findObject(project, parts[1]);
  if (!obj?.tracks) return;
  const channel = (parts.length === 4 ? `${parts[2]}.${parts[3]}` : parts[2]) as ChannelKey;
  if (obj.tracks[channel]?.length === 0) delete obj.tracks[channel];
}

export const useDocumentStore = create<DocumentState>()(
  temporal(
    immer((set) => ({
      project: createDefaultProject(),
      setProject: (project) =>
        set((s) => {
          s.project = migrateProject(project);
        }),
      setProjectName: (name) =>
        set((s) => {
          s.project.name = name;
        }),
      setActiveScene: (sceneId) =>
        set((s) => {
          if (s.project.scenes.some((sc) => sc.id === sceneId)) {
            s.project.activeSceneId = sceneId;
          }
        }),

      addImportedModel: (asset, object) =>
        set((s) => {
          s.project.assets[asset.id] = asset;
          activeSceneDraft(s.project).objects.push(object);
        }),

      addImportedModels: (assets, objects) =>
        set((s) => {
          for (const asset of assets) s.project.assets[asset.id] = asset;
          activeSceneDraft(s.project).objects.push(...objects);
        }),

      addMediaAsset: (asset) =>
        set((s) => {
          s.project.media[asset.id] = asset;
        }),

      addObjects: (objects) =>
        set((s) => {
          activeSceneDraft(s.project).objects.push(...objects);
        }),

      removeObjects: (ids) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const remove = new Set(ids);
          // Cascade: deleting a group deletes its descendants.
          let grew = true;
          while (grew) {
            grew = false;
            for (const o of scene.objects) {
              if (o.parentId && remove.has(o.parentId) && !remove.has(o.id)) {
                remove.add(o.id);
                grew = true;
              }
            }
          }
          const removedObjs = scene.objects.filter((o) => remove.has(o.id));
          scene.objects = scene.objects.filter((o) => !remove.has(o.id));
          // Drop any variable bindings that targeted the removed objects.
          for (const key of Object.keys(s.project.bindings ?? {})) {
            const parts = key.split(':');
            if (parts[0] === 'object' && remove.has(parts[1])) {
              delete s.project.bindings[key];
            }
          }
          // Free GPU/RAM for assets no longer referenced by any object anywhere.
          const stillUsed = new Set<string>();
          for (const sc of s.project.scenes)
            for (const o of sc.objects) if (o.assetId) stillUsed.add(o.assetId);
          for (const o of removedObjs) {
            if (o.assetId && !stillUsed.has(o.assetId)) {
              disposeGeometry(o.assetId);
              delete s.project.assets[o.assetId];
              void import('../io/persistence').then((m) => m.deleteGeometry(o.assetId!));
            }
          }
        }),

      setObjectName: (id, name) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.name = name;
        }),

      setObjectVisible: (id, visible) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.visible = visible;
        }),

      setObjectTransform: (id, transform) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.transform = transform;
        }),

      patchObjectTransform: (id, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.transform = { ...obj.transform, ...patch };
        }),

      setObjectMaterial: (id, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.material = { ...obj.material, ...patch };
        }),

      setObjectIdle: (id, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.idle = { ...(obj.idle ?? defaultIdle()), ...patch };
        }),

      setObjectTransition: (id, which, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (!obj) return;
          const key = which === 'start' ? 'startAnim' : 'endAnim';
          obj[key] = { ...(obj[key] ?? defaultTransition()), ...patch };
        }),

      setObjectCenterOfRotation: (id, center) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.centerOfRotation = center;
        }),

      patchObjectsTransform: (ids, patch) =>
        set((s) => {
          const set_ = new Set(ids);
          for (const o of activeSceneDraft(s.project).objects) {
            if (set_.has(o.id)) o.transform = { ...o.transform, ...patch };
          }
        }),

      setObjectsTransformComponent: (ids, field, axis, value) =>
        set((s) => {
          const set_ = new Set(ids);
          for (const o of activeSceneDraft(s.project).objects) {
            if (set_.has(o.id)) {
              const next = [...o.transform[field]] as [number, number, number];
              next[axis] = value;
              o.transform = { ...o.transform, [field]: next };
            }
          }
        }),

      setObjectsMaterial: (ids, patch) =>
        set((s) => {
          const set_ = new Set(ids);
          for (const o of activeSceneDraft(s.project).objects) {
            if (set_.has(o.id)) o.material = { ...o.material, ...patch };
          }
        }),

      setObjectsVisible: (ids, visible) =>
        set((s) => {
          const set_ = new Set(ids);
          for (const o of activeSceneDraft(s.project).objects) {
            if (set_.has(o.id)) o.visible = visible;
          }
        }),

      groupObjects: (group, childIds, localPositions) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          scene.objects.push(group);
          const set_ = new Set(childIds);
          for (const o of scene.objects) {
            if (set_.has(o.id)) {
              o.parentId = group.id;
              const lp = localPositions[o.id];
              if (lp) o.transform.position = lp;
            }
          }
        }),

      ungroupObjects: (groupId, childUpdates) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const byId = new Map(childUpdates.map((u) => [u.id, u]));
          for (const o of scene.objects) {
            const u = byId.get(o.id);
            if (u) {
              o.parentId = u.parentId;
              o.transform = u.transform;
            }
          }
          scene.objects = scene.objects.filter((o) => o.id !== groupId);
        }),

      setSceneName: (name) =>
        set((s) => {
          activeSceneDraft(s.project).name = name;
        }),

      setSceneDuration: (durationMs) =>
        set((s) => {
          activeSceneDraft(s.project).durationMs = Math.max(100, durationMs);
        }),

      patchSceneSettings: (patch) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          scene.settings = { ...scene.settings, ...patch };
        }),

      addScene: () =>
        set((s) => {
          const scene = createDefaultScene(`Scene ${s.project.scenes.length + 1}`);
          s.project.scenes.push(scene);
          s.project.activeSceneId = scene.id;
        }),

      removeScene: (sceneId) =>
        set((s) => {
          if (s.project.scenes.length <= 1) return;
          s.project.scenes = s.project.scenes.filter((sc) => sc.id !== sceneId);
          if (s.project.activeSceneId === sceneId) {
            s.project.activeSceneId = s.project.scenes[0].id;
          }
        }),

      renameScene: (sceneId, name) =>
        set((s) => {
          const sc = s.project.scenes.find((x) => x.id === sceneId);
          if (sc) sc.name = name;
        }),

      duplicateScene: () =>
        set((s) => {
          const clone = structuredClone(current(activeSceneDraft(s.project))) as Scene;
          clone.id = nanoid();
          clone.name = `${clone.name} copy`;
          const idMap = new Map<string, string>();
          for (const o of clone.objects) idMap.set(o.id, nanoid());
          for (const o of clone.objects) {
            o.id = idMap.get(o.id)!;
            if (o.parentId && idMap.has(o.parentId)) o.parentId = idMap.get(o.parentId)!;
            for (const track of Object.values(o.tracks)) {
              if (track) for (const k of track) k.id = nanoid();
            }
          }
          for (const k of clone.camera.keyframes) k.id = nanoid();
          s.project.scenes.push(clone);
          s.project.activeSceneId = clone.id;
        }),

      remapKeyframeTimes: (objectId, oldRange, newRange, mode) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (!obj?.tracks) return;
          const oldSpan = oldRange.endMs - oldRange.startMs || 1;
          const newSpan = newRange.endMs - newRange.startMs;
          for (const track of Object.values(obj.tracks)) {
            if (!track) continue;
            for (const k of track) {
              if (mode === 'scale') {
                k.timeMs =
                  newRange.startMs + (k.timeMs - oldRange.startMs) * (newSpan / oldSpan);
              } else if (Math.abs(k.timeMs - oldRange.startMs) <= 1) {
                k.timeMs = newRange.startMs;
              } else if (Math.abs(k.timeMs - oldRange.endMs) <= 1) {
                k.timeMs = newRange.endMs;
              }
            }
            track.sort((a, b) => a.timeMs - b.timeMs);
          }
        }),

      cycleKeyframe: (channelKey, timeMs) =>
        set((s) => {
          const ch = resolveChannel(s.project, channelKey);
          if (!ch) return;
          const existing = ch.track.find(
            (k) => Math.abs(k.timeMs - timeMs) <= KEYFRAME_EPSILON,
          );
          if (!existing) {
            ch.track.push({
              id: nanoid(),
              timeMs,
              value: ch.currentValue(),
              interpolation: 'linear',
            });
            ch.track.sort((a, b) => a.timeMs - b.timeMs);
            return;
          }
          const idx = EASE_ORDER.indexOf(existing.interpolation);
          if (idx >= EASE_ORDER.length - 1) {
            // step -> none: remove this keyframe
            const i = ch.track.indexOf(existing);
            ch.track.splice(i, 1);
            pruneEmptyTracks(s.project, channelKey);
          } else {
            existing.interpolation = EASE_ORDER[idx + 1];
          }
        }),

      setChannelKeyframeValue: (channelKey, timeMs, value) =>
        set((s) => {
          const ch = resolveChannel(s.project, channelKey);
          if (!ch) return;
          const existing = ch.track.find(
            (k) => Math.abs(k.timeMs - timeMs) <= KEYFRAME_EPSILON,
          );
          if (existing) {
            existing.value = value;
          } else {
            ch.track.push({ id: nanoid(), timeMs, value, interpolation: 'linear' });
            ch.track.sort((a, b) => a.timeMs - b.timeMs);
          }
        }),

      moveChannelKeyframe: (channelKey, kfId, timeMs) =>
        set((s) => {
          const ch = resolveChannel(s.project, channelKey);
          const kf = ch?.track.find((k) => k.id === kfId);
          if (kf && ch) {
            kf.timeMs = Math.max(0, timeMs);
            ch.track.sort((a, b) => a.timeMs - b.timeMs);
          }
        }),

      moveKeyframesAtTime: (objectId, fromMs, toMs) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (!obj?.tracks) return;
          const to = Math.max(0, toMs);
          for (const track of Object.values(obj.tracks)) {
            if (!track) continue;
            for (const k of track) {
              if (Math.abs(k.timeMs - fromMs) <= KEYFRAME_EPSILON) k.timeMs = to;
            }
            track.sort((a, b) => a.timeMs - b.timeMs);
          }
        }),

      deleteKeyframesAtTime: (objectId, timeMs) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (!obj?.tracks) return;
          for (const key of Object.keys(obj.tracks) as ChannelKey[]) {
            const track = obj.tracks[key]!;
            const filtered = track.filter(
              (k) => Math.abs(k.timeMs - timeMs) > KEYFRAME_EPSILON,
            );
            if (filtered.length === 0) delete obj.tracks[key];
            else obj.tracks[key] = filtered;
          }
        }),

      setObjectLifetime: (objectId, lifetime) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (obj) {
            obj.lifetime = {
              startMs: Math.max(0, Math.min(lifetime.startMs, lifetime.endMs - 1)),
              endMs: Math.max(lifetime.endMs, lifetime.startMs + 1),
            };
          }
        }),

      upsertCameraKeyframe: (timeMs, state, interpolation = 'linear') =>
        set((s) => {
          const cam = activeSceneDraft(s.project).camera;
          const existing = cam.keyframes.find(
            (k) => Math.abs(k.timeMs - timeMs) <= KEYFRAME_EPSILON,
          );
          if (existing) {
            existing.position = state.position;
            existing.target = state.target;
          } else {
            cam.keyframes.push({
              id: nanoid(),
              timeMs,
              interpolation,
              position: state.position,
              target: state.target,
            });
            cam.keyframes.sort((a, b) => a.timeMs - b.timeMs);
          }
        }),

      removeCameraKeyframe: (keyframeId) =>
        set((s) => {
          const cam = activeSceneDraft(s.project).camera;
          cam.keyframes = cam.keyframes.filter((k) => k.id !== keyframeId);
        }),

      addVariable: () =>
        set((s) => {
          const existing = new Set(s.project.variables.map((v) => v.name));
          let n = s.project.variables.length + 1;
          let name = `var${n}`;
          while (existing.has(name)) name = `var${++n}`;
          s.project.variables.push({ id: nanoid(), name, value: 0 });
        }),
      setVariableName: (id, name) =>
        set((s) => {
          const v = s.project.variables.find((x) => x.id === id);
          if (!v) return;
          // Keep identifiers valid and unique so expressions can reference them.
          const clean = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
          // `time` is reserved for the built-in render-time variable.
          if (
            !clean ||
            clean === TIME_VARIABLE ||
            s.project.variables.some((x) => x.id !== id && x.name === clean)
          )
            return;
          const old = v.name;
          v.name = clean;
          if (old !== clean) {
            for (const key of Object.keys(s.project.bindings)) {
              s.project.bindings[key] = renameIdentifier(s.project.bindings[key], old, clean);
            }
            // Rename references inside other variables' expressions too.
            for (const other of s.project.variables) {
              if (other.expr) other.expr = renameIdentifier(other.expr, old, clean);
            }
          }
          recomputeBindings(s.project);
        }),
      setVariableValue: (id, value) =>
        set((s) => {
          const v = s.project.variables.find((x) => x.id === id);
          if (!v) return;
          v.value = value;
          // A constant value overrides any prior expression.
          delete v.expr;
          recomputeBindings(s.project);
        }),
      setVariableExpr: (id, expr) =>
        set((s) => {
          const v = s.project.variables.find((x) => x.id === id);
          if (!v) return;
          const trimmed = expr.trim();
          if (!trimmed) {
            delete v.expr;
          } else if (!wouldCreateCycle(s.project.variables, id, trimmed)) {
            v.expr = trimmed;
          }
          recomputeBindings(s.project);
        }),
      removeVariable: (id) =>
        set((s) => {
          s.project.variables = s.project.variables.filter((x) => x.id !== id);
          recomputeBindings(s.project);
        }),
      setBinding: (key, expr) =>
        set((s) => {
          if (!expr.trim()) {
            delete s.project.bindings[key];
            return;
          }
          s.project.bindings[key] = expr;
          const value = evaluateExpr(expr, varsMap(s.project.variables));
          if (value != null) writeBoundValue(s.project, key, value);
        }),
      clearBinding: (key) =>
        set((s) => {
          delete s.project.bindings[key];
        }),
    })),
    {
      // Only the document is tracked for undo/redo — transient editor state
      // (selection, tool, playhead) lives in editorStore and is excluded.
      limit: 200,
      partialize: (state) => ({ project: state.project }),
      equality: (a, b) => a.project === b.project,
    },
  ),
);

/** Returns the currently active scene. Falls back to the first scene. */
export function getActiveScene(project: Project): Scene {
  return (
    project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0]
  );
}

/** Read-only lookup of a keyframe channel's track (object channel or `var:<id>`). */
export function getChannelTrack(
  project: Project,
  channelKey: string,
): ValueKeyframe[] | undefined {
  const parts = channelKey.split(':');
  if (parts[0] === 'var') {
    return project.variables.find((v) => v.id === parts[1])?.track;
  }
  if (parts[0] === 'object') {
    const obj = getActiveScene(project).objects.find((o) => o.id === parts[1]);
    const channel = (parts.length === 4 ? `${parts[2]}.${parts[3]}` : parts[2]) as ChannelKey;
    return obj?.tracks?.[channel];
  }
  return undefined;
}

/** The keyframe exactly at `timeMs` on a track (±epsilon), if any. */
export function keyframeAtTime(
  track: ValueKeyframe[] | undefined,
  timeMs: number,
): ValueKeyframe | undefined {
  return track?.find((k) => Math.abs(k.timeMs - timeMs) <= KEYFRAME_EPSILON);
}

/** Hook selector for the active scene. */
export function useActiveScene(): Scene {
  return useDocumentStore((s) => getActiveScene(s.project));
}

/** Hook selector for a single object in the active scene. */
export function useObject(id: string | undefined): SceneObject | undefined {
  return useDocumentStore((s) =>
    id ? getActiveScene(s.project).objects.find((o) => o.id === id) : undefined,
  );
}

export const undo = () => useDocumentStore.temporal.getState().undo();
export const redo = () => useDocumentStore.temporal.getState().redo();
export const clearHistory = () => useDocumentStore.temporal.getState().clear();

/** Reactive selector over the temporal (undo/redo) store. */
export function useTemporal<T>(
  selector: (state: {
    pastStates: unknown[];
    futureStates: unknown[];
  }) => T,
): T {
  return useStore(useDocumentStore.temporal, selector);
}

import { create } from 'zustand';
import { useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { nanoid } from 'nanoid';
import { current } from 'immer';
import {
  createAudioTrack,
  createDefaultProject,
  createDefaultScene,
  createGlyphObject,
  defaultLightParams,
  defaultSurfaceParams,
  defaultTextParams,
} from './defaults';
import { normalizeWinding } from '../scene/surfaceGeometry';
import { materialsEqual, type TextEditPlan } from '../scene/textLayout';
import type {
  Asset,
  AudioClip,
  AudioTrack,
  CameraState,
  ChannelKey,
  Easing,
  IdleAnimation,
  Lifetime,
  LightParams,
  Material,
  MediaAsset,
  Project,
  Scene,
  SceneObject,
  SceneSettings,
  SurfaceParams,
  TextParams,
  Transform,
  Transition,
  ValueKeyframe,
  Vec3,
} from './types';
import { defaultIdle, defaultTransition, MARKER_COLORS, TIME_VARIABLE } from './types';
import { resolveOverlaps } from './audioOverlap';
import { evaluateExpr, renameIdentifier, varsMap } from './expr';
import { recomputeBindings, writeBoundValue } from './bindings';
import { migrateProject } from './migrate';
import { evaluateCamera, evaluateObject } from '../animation/evaluate';
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
  /** Patch light params; creates the block from defaults on first use. */
  setObjectLight: (id: string, patch: Partial<LightParams>) => void;
  /** Patch surface params; creates the block from defaults on first use. */
  setObjectSurface: (id: string, patch: Partial<SurfaceParams>) => void;
  /** Patch text params that need no re-layout (writeOn, fontId). Layout-affecting
   * edits go through `applyTextEdit` so glyph children reconcile. */
  setObjectText: (id: string, patch: Partial<TextParams>) => void;
  /** Apply a reconciliation plan from scene/textLayout.planTextEdit in one undo
   * step: writes params, deletes/creates glyph children, re-anchors survivors
   * (preserving user offsets and shifting position keyframes accordingly). */
  applyTextEdit: (id: string, plan: TextEditPlan) => void;
  /** Patch a text parent's material and propagate to glyph children that still
   * match the parent (i.e. haven't been individually recolored). */
  setTextMaterial: (id: string, patch: Partial<Material>) => void;
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
  /**
   * Split at a time: with exactly one selected object, splits only that
   * object's lifetime; otherwise splits every leaf object AND every audio
   * clip whose span currently covers the time (batch). One undo step
   * regardless of how many clips split. No-op for anything not spanning the
   * time, and for objects with children (ambiguous, deferred).
   */
  splitAtPlayhead: (playheadMs: number, selectedIds: string[]) => void;
  /** Trim a leaf object's lifetime edge to a time, retiming its keyframes to
   * the new boundary. No-op if the time isn't strictly inside its span. */
  rippleTrimObjectToPlayhead: (
    objectId: string,
    playheadMs: number,
    edge: 'in' | 'out',
  ) => void;
  /** Trim an audio clip's edge to a time (adjusting offset/duration to match).
   * No-op if the time isn't strictly inside the clip's span. */
  rippleTrimAudioClipToPlayhead: (
    trackId: string,
    clipId: string,
    playheadMs: number,
    edge: 'in' | 'out',
  ) => void;
  /** Duplicate a leaf object adjacent in time (new clip starts where the
   * original ends), keyframes shifted by the same span. */
  duplicateObjectAdjacent: (objectId: string) => void;
  /** Duplicate an audio clip adjacent in time on the same track. */
  duplicateAudioClipAdjacent: (trackId: string, clipId: string) => void;

  /** Bake the given pose onto all six camera channels (position + target) at
   * a time, one keyframe per axis. Used by the "keyframe the camera" buttons
   * to snapshot the live, hand-navigated camera in one action. */
  upsertCameraKeyframe: (
    timeMs: number,
    state: CameraState,
    interpolation?: Easing,
  ) => void;
  /** Remove every camera channel's keyframe at a time (±epsilon). */
  removeCameraKeyframeAtTime: (timeMs: number) => void;
  /** Patch the camera's fallback pose for axes with no keyframes. */
  patchCameraDefault: (patch: Partial<CameraState>) => void;

  /** Audio tracks + clips (background music, sound effects) on the timeline. */
  /** Timeline markers. Adding at an occupied time is a no-op. */
  addMarker: (timeMs: number, name?: string) => void;
  renameMarker: (id: string, name: string) => void;
  setMarkerColor: (id: string, color: string) => void;
  moveMarker: (id: string, timeMs: number) => void;
  removeMarker: (id: string) => void;

  addAudioTrack: (name?: string) => void;
  removeAudioTrack: (trackId: string) => void;
  renameAudioTrack: (trackId: string, name: string) => void;
  setAudioTrackGain: (trackId: string, gain: number) => void;
  setAudioTrackMuted: (trackId: string, muted: boolean) => void;
  /** Add a placed clip to a track (kept sorted by start time). */
  addAudioClip: (trackId: string, clip: AudioClip) => void;
  removeAudioClip: (trackId: string, clipId: string) => void;
  /** Move a clip along the timeline (drag body), keeping its trim/length.
   * Transient overlaps are allowed — call `moveAudioClipResolved` on drop. */
  setAudioClipTime: (trackId: string, clipId: string, startMs: number) => void;
  /**
   * Final placement of a dragged clip plus overwrite-resolution of whatever it
   * landed on, in one undo step. Called on pointerup rather than per
   * pointermove: truncating continuously would repeatedly destroy the clip
   * being swept across.
   */
  moveAudioClipResolved: (trackId: string, clipId: string, startMs: number) => void;
  /**
   * Set a clip's placement + trim in one step (drag either edge). `startMs`
   * defaults to the current start. All fields are clamped to the source length.
   */
  setAudioClipRange: (
    trackId: string,
    clipId: string,
    range: { startMs?: number; offsetMs: number; durationMs: number },
  ) => void;
  setAudioClipGain: (trackId: string, clipId: string, gain: number) => void;
  setAudioClipLoop: (trackId: string, clipId: string, loop: boolean) => void;
  /** Move a clip to a different track (drag across lanes). */
  moveAudioClipToTrack: (
    fromTrackId: string,
    clipId: string,
    toTrackId: string,
  ) => void;

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

function findAudioTrack(project: Project, trackId: string): AudioTrack | undefined {
  const scene = activeSceneDraft(project);
  scene.audioTracks ??= [];
  return scene.audioTracks.find((t) => t.id === trackId);
}

/**
 * Enforces the no-overlap invariant on one audio track after `keepClipId` was
 * placed: overwrite semantics, so whatever it landed on is trimmed, removed, or
 * split. Mutates the draft in place, so the caller's single `set()` stays one
 * undo entry no matter how many clips are touched.
 */
function applyOverlapResolution(track: AudioTrack, keepClipId: string): void {
  const moved = track.clips.find((c) => c.id === keepClipId);
  if (!moved) return;
  // Snapshot before mutating: an interior split needs the pre-mutation clip both
  // to update it and to clone its tail.
  const others = track.clips.filter((c) => c.id !== keepClipId).map((c) => current(c));
  const res = resolveOverlaps(
    { id: moved.id, startMs: moved.startMs, durationMs: moved.durationMs },
    others,
  );
  if (res.removeIds.length === 0 && res.updates.length === 0 && res.inserts.length === 0) {
    return;
  }
  const byId = new Map(others.map((c) => [c.id, c]));
  for (const u of res.updates) {
    const target = track.clips.find((c) => c.id === u.id);
    if (target) {
      target.startMs = u.startMs;
      target.offsetMs = u.offsetMs;
      target.durationMs = u.durationMs;
    }
  }
  if (res.removeIds.length > 0) {
    track.clips = track.clips.filter((c) => !res.removeIds.includes(c.id));
  }
  for (const ins of res.inserts) {
    const src = byId.get(ins.sourceId);
    if (!src) continue;
    track.clips.push({
      ...src,
      id: nanoid(),
      startMs: ins.startMs,
      offsetMs: ins.offsetMs,
      durationMs: ins.durationMs,
    });
  }
  track.clips.sort((a, b) => a.startMs - b.startMs);
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

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
        if (channel === 'text.writeOn') return pose.writeOn ?? 1;
        if (channel.startsWith('light.')) {
          const light = pose.light ?? defaultLightParams();
          if (channel === 'light.color') return light.color;
          if (channel === 'light.intensity') return light.intensity;
          if (channel === 'light.spread') return light.spreadDeg;
          if (channel === 'light.softness') return light.softness;
          return light.direction[Number(channel.split('.')[2])];
        }
        const [name, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', string];
        return pose[name][Number(axis)];
      },
    };
  }
  if (parts[0] === 'camera') {
    const cam = activeSceneDraft(project).camera;
    const channel = `${parts[1]}.${parts[2]}` as ChannelKey;
    cam.tracks ??= {};
    cam.tracks[channel] ??= [];
    return {
      track: cam.tracks[channel]!,
      currentValue: () => {
        const time = useEditorStore.getState().playheadMs;
        const pose = evaluateCamera(cam.default, cam.tracks, time);
        const [name, axis] = channel.split('.') as ['position' | 'target', string];
        return pose[name][Number(axis)];
      },
    };
  }
  return undefined;
}

/** Removes empty channel tracks from an object (or the camera) so it reads as un-animated. */
function pruneEmptyTracks(project: Project, channelKey: string): void {
  const parts = channelKey.split(':');
  if (parts[0] === 'camera') {
    const cam = activeSceneDraft(project).camera;
    const channel = `${parts[1]}.${parts[2]}` as ChannelKey;
    if (cam.tracks?.[channel]?.length === 0) delete cam.tracks[channel];
    return;
  }
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
          // Deleting a glyph directly also removes its character from the
          // parent text (kept in sync; surviving glyphs are re-indexed but not
          // re-laid-out — the gap stays until the next text edit).
          const glyphIndexesByParent = new Map<string, number[]>();
          for (const o of removedObjs) {
            if (o.type === 'glyph' && o.glyph && o.parentId && !remove.has(o.parentId)) {
              const list = glyphIndexesByParent.get(o.parentId) ?? [];
              list.push(o.glyph.index);
              glyphIndexesByParent.set(o.parentId, list);
            }
          }
          for (const [parentId, indexes] of glyphIndexesByParent) {
            const parent = scene.objects.find((o) => o.id === parentId);
            if (!parent?.text) continue;
            indexes.sort((a, b) => b - a);
            const chars = Array.from(parent.text.text);
            for (const i of indexes) if (i < chars.length) chars.splice(i, 1);
            parent.text.text = chars.join('');
            for (const g of scene.objects) {
              if (g.parentId === parentId && g.type === 'glyph' && g.glyph) {
                g.glyph.index -= indexes.filter((i) => i < g.glyph!.index).length;
              }
            }
          }
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

      setObjectLight: (id, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (obj) obj.light = { ...(obj.light ?? defaultLightParams()), ...patch };
        }),

      setObjectSurface: (id, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (!obj) return;
          // Normalize winding here so the CCW invariant holds no matter which
          // edit path (inspector, vertex handles, presets) wrote the points.
          const next = patch.points
            ? { ...patch, points: normalizeWinding(patch.points) }
            : patch;
          obj.surface = { ...(obj.surface ?? defaultSurfaceParams()), ...next };
        }),

      setObjectText: (id, patch) =>
        set((s) => {
          const obj = findObject(s.project, id);
          if (!obj || obj.type !== 'text') return;
          obj.text = { ...(obj.text ?? defaultTextParams()), ...patch };
        }),

      applyTextEdit: (id, plan) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const obj = scene.objects.find((o) => o.id === id);
          if (!obj || obj.type !== 'text') return;
          obj.text = { ...plan.params };
          if (plan.removedIds.length > 0) {
            const removed = new Set(plan.removedIds);
            scene.objects = scene.objects.filter((o) => !removed.has(o.id));
            for (const key of Object.keys(s.project.bindings ?? {})) {
              const parts = key.split(':');
              if (parts[0] === 'object' && removed.has(parts[1])) {
                delete s.project.bindings[key];
              }
            }
          }
          const axisChannels: ChannelKey[] = ['position.0', 'position.1', 'position.2'];
          for (const m of plan.moved) {
            const g = scene.objects.find((o) => o.id === m.id);
            if (!g?.glyph) continue;
            const delta: Vec3 = [
              m.layoutPos[0] - g.glyph.layoutPos[0],
              m.layoutPos[1] - g.glyph.layoutPos[1],
              m.layoutPos[2] - g.glyph.layoutPos[2],
            ];
            g.transform.position = [
              g.transform.position[0] + delta[0],
              g.transform.position[1] + delta[1],
              g.transform.position[2] + delta[2],
            ];
            axisChannels.forEach((ch, axis) => {
              const track = g.tracks?.[ch];
              if (track) for (const kf of track) kf.value = (kf.value as number) + delta[axis];
            });
            g.glyph.index = m.index;
            g.glyph.layoutPos = [...m.layoutPos];
          }
          for (const a of plan.added) {
            scene.objects.push(createGlyphObject(obj, a.char, a.index, a.layoutPos));
          }
        }),

      setTextMaterial: (id, patch) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const obj = scene.objects.find((o) => o.id === id);
          if (!obj || obj.type !== 'text') return;
          const prev = { ...obj.material };
          obj.material = { ...obj.material, ...patch };
          for (const g of scene.objects) {
            if (g.parentId === id && g.type === 'glyph' && materialsEqual(g.material, prev)) {
              g.material = { ...g.material, ...patch };
            }
          }
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
          for (const track of Object.values(clone.camera.tracks)) {
            if (track) for (const k of track) k.id = nanoid();
          }
          for (const t of clone.audioTracks ?? []) {
            t.id = nanoid();
            for (const c of t.clips) c.id = nanoid();
          }
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

      splitAtPlayhead: (playheadMs, selectedIds) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const isLeaf = (id: string) => !scene.objects.some((o) => o.parentId === id);

          const targetObjects =
            selectedIds.length === 1
              ? scene.objects.filter((o) => o.id === selectedIds[0])
              : scene.objects.filter(
                  (o) => o.lifetime.startMs < playheadMs && playheadMs < o.lifetime.endMs,
                );

          for (const obj of targetObjects) {
            if (!(obj.lifetime.startMs < playheadMs && playheadMs < obj.lifetime.endMs)) continue;
            if (!isLeaf(obj.id)) continue;

            const clone = structuredClone(current(obj)) as SceneObject;
            clone.id = nanoid();
            clone.lifetime = { startMs: playheadMs, endMs: obj.lifetime.endMs };
            obj.lifetime = { startMs: obj.lifetime.startMs, endMs: playheadMs };

            // Partition each channel's keyframes: earlier ones stay on the
            // original, later (or exactly-at-the-cut) ones move to the clone
            // with fresh ids so they never collide with the original's.
            for (const key of Object.keys(obj.tracks) as ChannelKey[]) {
              const track = obj.tracks[key];
              if (!track) continue;
              const before = track.filter((k) => k.timeMs < playheadMs);
              const atOrAfter = track
                .filter((k) => k.timeMs >= playheadMs)
                .map((k) => ({ ...k, id: nanoid() }));
              if (before.length) obj.tracks[key] = before;
              else delete obj.tracks[key];
              if (atOrAfter.length) clone.tracks[key] = atOrAfter;
              else delete clone.tracks[key];
            }
            scene.objects.push(clone);
          }

          // Audio clips only split in the batch case — a single selected
          // object's split is scoped to that object alone. No overlap
          // resolution needed: the two halves are butt-joined, which is legal.
          if (selectedIds.length !== 1) {
            for (const track of scene.audioTracks ?? []) {
              for (const clip of [...track.clips]) {
                const clipEnd = clip.startMs + clip.durationMs;
                if (!(clip.startMs < playheadMs && playheadMs < clipEnd)) continue;
                const firstDur = playheadMs - clip.startMs;
                const newClip: AudioClip = {
                  ...clip,
                  id: nanoid(),
                  startMs: playheadMs,
                  offsetMs: clip.offsetMs + firstDur,
                  durationMs: clip.durationMs - firstDur,
                };
                clip.durationMs = firstDur;
                track.clips.push(newClip);
              }
              track.clips.sort((a, b) => a.startMs - b.startMs);
            }
          }
        }),

      rippleTrimObjectToPlayhead: (objectId, playheadMs, edge) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (!obj) return;
          const { startMs, endMs } = obj.lifetime;
          if (!(playheadMs > startMs && playheadMs < endMs)) return;
          if (edge === 'in') {
            obj.lifetime = { startMs: playheadMs, endMs };
            for (const track of Object.values(obj.tracks)) {
              if (!track) continue;
              for (const k of track) if (k.timeMs < playheadMs) k.timeMs = playheadMs;
              track.sort((a, b) => a.timeMs - b.timeMs);
            }
          } else {
            obj.lifetime = { startMs, endMs: playheadMs };
            for (const track of Object.values(obj.tracks)) {
              if (!track) continue;
              for (const k of track) if (k.timeMs > playheadMs) k.timeMs = playheadMs;
              track.sort((a, b) => a.timeMs - b.timeMs);
            }
          }
        }),

      rippleTrimAudioClipToPlayhead: (trackId, clipId, playheadMs, edge) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          const c = t?.clips.find((x) => x.id === clipId);
          if (!t || !c) return;
          const clipStart = c.startMs;
          const clipEnd = c.startMs + c.durationMs;
          if (!(playheadMs > clipStart && playheadMs < clipEnd)) return;
          if (edge === 'in') {
            const delta = playheadMs - clipStart;
            c.startMs = playheadMs;
            c.offsetMs += delta;
            c.durationMs -= delta;
          } else {
            c.durationMs = playheadMs - clipStart;
          }
          t.clips.sort((a, b) => a.startMs - b.startMs);
        }),

      duplicateObjectAdjacent: (objectId) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const obj = scene.objects.find((o) => o.id === objectId);
          if (!obj) return;
          if (scene.objects.some((o) => o.parentId === objectId)) return; // leaf-only
          const clone = structuredClone(current(obj)) as SceneObject;
          clone.id = nanoid();
          const span = obj.lifetime.endMs - obj.lifetime.startMs;
          clone.lifetime = { startMs: obj.lifetime.endMs, endMs: obj.lifetime.endMs + span };
          for (const track of Object.values(clone.tracks)) {
            if (!track) continue;
            for (const k of track) {
              k.id = nanoid();
              k.timeMs += span;
            }
          }
          scene.objects.push(clone);
        }),

      duplicateAudioClipAdjacent: (trackId, clipId) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          const c = t?.clips.find((x) => x.id === clipId);
          if (!t || !c) return;
          const clone: AudioClip = { ...c, id: nanoid(), startMs: c.startMs + c.durationMs };
          t.clips.push(clone);
          t.clips.sort((a, b) => a.startMs - b.startMs);
          // The slot after the original may already be occupied; the clone wins.
          applyOverlapResolution(t, clone.id);
        }),

      upsertCameraKeyframe: (timeMs, state, interpolation = 'linear') =>
        set((s) => {
          const cam = activeSceneDraft(s.project).camera;
          cam.tracks ??= {};
          const axes: [ChannelKey, number][] = [
            ['position.0', state.position[0]],
            ['position.1', state.position[1]],
            ['position.2', state.position[2]],
            ['target.0', state.target[0]],
            ['target.1', state.target[1]],
            ['target.2', state.target[2]],
          ];
          for (const [channel, value] of axes) {
            const track = (cam.tracks[channel] ??= []);
            const existing = track.find(
              (k) => Math.abs(k.timeMs - timeMs) <= KEYFRAME_EPSILON,
            );
            if (existing) existing.value = value;
            else {
              track.push({ id: nanoid(), timeMs, value, interpolation });
              track.sort((a, b) => a.timeMs - b.timeMs);
            }
          }
        }),

      removeCameraKeyframeAtTime: (timeMs) =>
        set((s) => {
          const cam = activeSceneDraft(s.project).camera;
          if (!cam.tracks) return;
          for (const key of Object.keys(cam.tracks) as ChannelKey[]) {
            const track = cam.tracks[key]!;
            const filtered = track.filter(
              (k) => Math.abs(k.timeMs - timeMs) > KEYFRAME_EPSILON,
            );
            if (filtered.length === 0) delete cam.tracks[key];
            else cam.tracks[key] = filtered;
          }
        }),

      patchCameraDefault: (patch) =>
        set((s) => {
          const cam = activeSceneDraft(s.project).camera;
          cam.default = { ...cam.default, ...patch };
        }),

      addMarker: (timeMs, name) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          scene.markers ??= [];
          // One marker per time slot: a second press of M at the same spot
          // should be a no-op rather than stacking invisible duplicates.
          if (scene.markers.some((m) => Math.abs(m.timeMs - timeMs) <= KEYFRAME_EPSILON)) {
            return;
          }
          const n = scene.markers.length;
          scene.markers.push({
            id: nanoid(),
            timeMs,
            name: name ?? `Marker ${n + 1}`,
            color: MARKER_COLORS[n % MARKER_COLORS.length],
          });
          scene.markers.sort((a, b) => a.timeMs - b.timeMs);
        }),

      renameMarker: (id, name) =>
        set((s) => {
          const m = activeSceneDraft(s.project).markers?.find((x) => x.id === id);
          if (m) m.name = name;
        }),

      setMarkerColor: (id, color) =>
        set((s) => {
          const m = activeSceneDraft(s.project).markers?.find((x) => x.id === id);
          if (m) m.color = color;
        }),

      moveMarker: (id, timeMs) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          const m = scene.markers?.find((x) => x.id === id);
          if (!m) return;
          m.timeMs = Math.max(0, Math.min(scene.durationMs, timeMs));
          scene.markers!.sort((a, b) => a.timeMs - b.timeMs);
        }),

      removeMarker: (id) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          scene.markers = (scene.markers ?? []).filter((m) => m.id !== id);
        }),

      addAudioTrack: (name) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          scene.audioTracks ??= [];
          scene.audioTracks.push(
            createAudioTrack(name ?? `Audio ${scene.audioTracks.length + 1}`),
          );
        }),
      removeAudioTrack: (trackId) =>
        set((s) => {
          const scene = activeSceneDraft(s.project);
          scene.audioTracks = (scene.audioTracks ?? []).filter((t) => t.id !== trackId);
        }),
      renameAudioTrack: (trackId, name) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          if (t) t.name = name;
        }),
      setAudioTrackGain: (trackId, gain) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          if (t) t.gain = clamp01(gain);
        }),
      setAudioTrackMuted: (trackId, muted) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          if (t) t.muted = muted;
        }),
      addAudioClip: (trackId, clip) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          if (!t) return;
          t.clips.push(clip);
          t.clips.sort((a, b) => a.startMs - b.startMs);
          // Importing at the playhead can land on an occupied slot.
          applyOverlapResolution(t, clip.id);
        }),
      removeAudioClip: (trackId, clipId) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          if (t) t.clips = t.clips.filter((c) => c.id !== clipId);
        }),
      setAudioClipTime: (trackId, clipId, startMs) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          const c = t?.clips.find((x) => x.id === clipId);
          if (!t || !c) return;
          c.startMs = Math.max(0, startMs);
          t.clips.sort((a, b) => a.startMs - b.startMs);
        }),
      moveAudioClipResolved: (trackId, clipId, startMs) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          const c = t?.clips.find((x) => x.id === clipId);
          if (!t || !c) return;
          c.startMs = Math.max(0, startMs);
          t.clips.sort((a, b) => a.startMs - b.startMs);
          applyOverlapResolution(t, clipId);
        }),
      setAudioClipRange: (trackId, clipId, range) =>
        set((s) => {
          const t = findAudioTrack(s.project, trackId);
          const c = t?.clips.find((x) => x.id === clipId);
          if (!t || !c) return;
          // Trimming can never grow through a neighbour. Scans rather than
          // adjacent-index lookups, so this is still correct on a legacy
          // document that arrived with overlaps.
          let minStart = 0;
          let maxEnd = Infinity;
          for (const x of t.clips) {
            if (x.id === c.id) continue;
            const xEnd = x.startMs + x.durationMs;
            if (x.startMs < c.startMs) minStart = Math.max(minStart, xEnd);
            else maxEnd = Math.min(maxEnd, x.startMs);
          }
          const requestedStart = range.startMs ?? c.startMs;
          const startMs = Math.max(minStart, Math.max(0, requestedStart));
          // Shift the trim-in by however far the left edge was clamped, so the
          // audible content stays put under the edge.
          const shift = startMs - requestedStart;
          let offsetMs = range.offsetMs + shift;
          let durationMs = range.durationMs - shift;
          durationMs = Math.min(durationMs, maxEnd - startMs);
          // Then the source-length clamps: a non-looping clip can't play past
          // the end of its source, so its duration is capped to the remainder.
          offsetMs = Math.max(0, Math.min(offsetMs, c.sourceDurationMs - 1));
          const maxDur = c.loop ? Infinity : c.sourceDurationMs - offsetMs;
          c.startMs = startMs;
          c.offsetMs = offsetMs;
          c.durationMs = Math.max(1, Math.min(durationMs, maxDur));
          t.clips.sort((a, b) => a.startMs - b.startMs);
        }),
      setAudioClipGain: (trackId, clipId, gain) =>
        set((s) => {
          const c = findAudioTrack(s.project, trackId)?.clips.find((x) => x.id === clipId);
          if (c) c.gain = clamp01(gain);
        }),
      setAudioClipLoop: (trackId, clipId, loop) =>
        set((s) => {
          const c = findAudioTrack(s.project, trackId)?.clips.find((x) => x.id === clipId);
          if (c) c.loop = loop;
        }),
      moveAudioClipToTrack: (fromTrackId, clipId, toTrackId) =>
        set((s) => {
          if (fromTrackId === toTrackId) return;
          const from = findAudioTrack(s.project, fromTrackId);
          const to = findAudioTrack(s.project, toTrackId);
          if (!from || !to) return;
          const idx = from.clips.findIndex((c) => c.id === clipId);
          if (idx < 0) return;
          const [clip] = from.clips.splice(idx, 1);
          to.clips.push(clip);
          to.clips.sort((a, b) => a.startMs - b.startMs);
          applyOverlapResolution(to, clip.id);
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
  if (parts[0] === 'camera') {
    const channel = `${parts[1]}.${parts[2]}` as ChannelKey;
    return getActiveScene(project).camera.tracks?.[channel];
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

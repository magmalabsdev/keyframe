import { create } from 'zustand';
import { useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { nanoid } from 'nanoid';
import { createDefaultProject } from './defaults';
import type {
  Asset,
  CameraState,
  Easing,
  Lifetime,
  Material,
  Project,
  Scene,
  SceneObject,
  SceneSettings,
  Transform,
} from './types';

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

  /** Create or update a keyframe at the given time for an object. */
  upsertKeyframe: (
    objectId: string,
    timeMs: number,
    transform: Transform,
    interpolation?: Easing,
  ) => void;
  removeKeyframe: (objectId: string, keyframeId: string) => void;
  setKeyframeInterpolation: (
    objectId: string,
    keyframeId: string,
    interpolation: Easing,
  ) => void;
  setKeyframeTime: (objectId: string, keyframeId: string, timeMs: number) => void;
  setObjectLifetime: (objectId: string, lifetime: Lifetime) => void;

  upsertCameraKeyframe: (
    timeMs: number,
    state: CameraState,
    interpolation?: Easing,
  ) => void;
  removeCameraKeyframe: (keyframeId: string) => void;
}

function activeSceneDraft(project: Project): Scene {
  return (
    project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0]
  );
}

function findObject(project: Project, id: string): SceneObject | undefined {
  return activeSceneDraft(project).objects.find((o) => o.id === id);
}

export const useDocumentStore = create<DocumentState>()(
  temporal(
    immer((set) => ({
      project: createDefaultProject(),
      setProject: (project) =>
        set((s) => {
          s.project = project;
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
          scene.objects = scene.objects.filter((o) => !remove.has(o.id));
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

      upsertKeyframe: (objectId, timeMs, transform, interpolation = 'linear') =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (!obj) return;
          const existing = obj.keyframes.find(
            (k) => Math.abs(k.timeMs - timeMs) <= KEYFRAME_EPSILON,
          );
          if (existing) {
            existing.position = transform.position;
            existing.rotation = transform.rotation;
            existing.scale = transform.scale;
          } else {
            obj.keyframes.push({
              id: nanoid(),
              timeMs,
              interpolation,
              position: transform.position,
              rotation: transform.rotation,
              scale: transform.scale,
            });
            obj.keyframes.sort((a, b) => a.timeMs - b.timeMs);
          }
        }),

      removeKeyframe: (objectId, keyframeId) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          if (obj) obj.keyframes = obj.keyframes.filter((k) => k.id !== keyframeId);
        }),

      setKeyframeInterpolation: (objectId, keyframeId, interpolation) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          const kf = obj?.keyframes.find((k) => k.id === keyframeId);
          if (kf) kf.interpolation = interpolation;
        }),

      setKeyframeTime: (objectId, keyframeId, timeMs) =>
        set((s) => {
          const obj = findObject(s.project, objectId);
          const kf = obj?.keyframes.find((k) => k.id === keyframeId);
          if (kf) {
            kf.timeMs = Math.max(0, timeMs);
            obj!.keyframes.sort((a, b) => a.timeMs - b.timeMs);
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

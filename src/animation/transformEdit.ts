import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { CameraState, ChannelKey, LightParams, Transform, ValueKeyframe } from '../state/types';
import { evaluateObject, type LightValues } from './evaluate';

function findObject(objectId: string) {
  const project = useDocumentStore.getState().project;
  return getActiveScene(project).objects.find((o) => o.id === objectId);
}

/** Channels that currently have at least one keyframe. */
function animatedChannels(tracks: Record<string, ValueKeyframe[] | undefined>): ChannelKey[] {
  return (Object.keys(tracks) as ChannelKey[]).filter((c) => (tracks[c]?.length ?? 0) > 0);
}

/**
 * Apply a transform edit from a gizmo or inspector. For each axis: if that
 * channel is keyframed, auto-key the new value at the playhead; otherwise
 * update the object's static base transform. Independent per-channel.
 */
export function applyTransformEdit(objectId: string, transform: Transform): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const doc = useDocumentStore.getState();
  const timeMs = useEditorStore.getState().playheadMs;
  const animated = new Set(animatedChannels(obj.tracks));

  let staticPatch: Partial<Transform> | null = null;
  const fields: ['position' | 'rotation' | 'scale', readonly ChannelKey[]][] = [
    ['position', ['position.0', 'position.1', 'position.2']],
    ['rotation', ['rotation.0', 'rotation.1', 'rotation.2']],
    ['scale', ['scale.0', 'scale.1', 'scale.2']],
  ];
  for (const [field, channels] of fields) {
    for (let axis = 0; axis < 3; axis++) {
      const channel = channels[axis];
      if (animated.has(channel)) {
        doc.setChannelKeyframeValue(`object:${objectId}:${field}:${axis}`, timeMs, transform[field][axis]);
      } else {
        (staticPatch ??= {})[field] = transform[field];
      }
    }
  }
  if (staticPatch) doc.patchObjectTransform(objectId, staticPatch);
}

/**
 * Apply a camera position/target edit from the inspector. For each provided
 * field, per axis: if that camera channel is keyframed, auto-key the new value
 * at the playhead; otherwise update the camera's static default pose.
 * Independent per-channel, mirroring applyTransformEdit.
 */
export function applyCameraTransformEdit(patch: {
  position?: CameraState['position'];
  target?: CameraState['target'];
}): void {
  const doc = useDocumentStore.getState();
  const scene = getActiveScene(doc.project);
  const timeMs = useEditorStore.getState().playheadMs;
  const tracks = scene.camera.tracks ?? {};

  let staticPatch: Partial<CameraState> | null = null;
  const fields: ['position' | 'target', readonly ChannelKey[]][] = [
    ['position', ['position.0', 'position.1', 'position.2']],
    ['target', ['target.0', 'target.1', 'target.2']],
  ];
  for (const [field, channels] of fields) {
    const value = patch[field];
    if (!value) continue;
    for (let axis = 0; axis < 3; axis++) {
      const channel = channels[axis];
      if ((tracks[channel]?.length ?? 0) > 0) {
        doc.setChannelKeyframeValue(`camera:${field}:${axis}`, timeMs, value[axis]);
      } else {
        (staticPatch ??= {})[field] = value;
      }
    }
  }
  if (staticPatch) doc.patchCameraDefault(staticPatch);
}

/**
 * Apply a color edit from the inspector. If the color channel is keyframed,
 * auto-key it at the playhead; otherwise update the static material color.
 */
export function applyColorEdit(objectId: string, color: string): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const doc = useDocumentStore.getState();
  if ((obj.tracks.color?.length ?? 0) > 0) {
    const timeMs = useEditorStore.getState().playheadMs;
    doc.setChannelKeyframeValue(`object:${objectId}:color`, timeMs, color);
  } else {
    doc.setObjectMaterial(objectId, { color });
  }
}

/** Reads one light channel's value out of evaluated light values. */
function lightChannelValue(light: LightValues, channel: ChannelKey): number | string {
  if (channel === 'light.color') return light.color;
  if (channel === 'light.intensity') return light.intensity;
  if (channel === 'light.spread') return light.spreadDeg;
  if (channel === 'light.softness') return light.softness;
  return light.direction[Number(channel.split('.')[2])];
}

/**
 * Apply a light-param edit from the inspector. Per changed prop: if its
 * channel is keyframed, auto-key the new value at the playhead; otherwise
 * patch the object's base light params. Mirrors applyTransformEdit.
 */
export function applyLightEdit(
  objectId: string,
  patch: Partial<Omit<LightParams, 'enabled'>>,
): void {
  const obj = findObject(objectId);
  if (!obj) return;
  const doc = useDocumentStore.getState();
  const timeMs = useEditorStore.getState().playheadMs;
  const animated = new Set(animatedChannels(obj.tracks));

  let staticPatch: Partial<LightParams> | null = null;
  const scalars: [keyof Omit<LightParams, 'enabled' | 'direction'>, ChannelKey][] = [
    ['color', 'light.color'],
    ['intensity', 'light.intensity'],
    ['spreadDeg', 'light.spread'],
    ['softness', 'light.softness'],
  ];
  for (const [prop, channel] of scalars) {
    const value = patch[prop];
    if (value === undefined) continue;
    if (animated.has(channel)) {
      doc.setChannelKeyframeValue(`object:${objectId}:${channel}`, timeMs, value as number | string);
    } else {
      (staticPatch ??= {})[prop] = value as never;
    }
  }
  if (patch.direction) {
    for (let axis = 0; axis < 3; axis++) {
      const channel = `light.direction.${axis}` as ChannelKey;
      if (animated.has(channel)) {
        doc.setChannelKeyframeValue(
          `object:${objectId}:light.direction:${axis}`,
          timeMs,
          patch.direction[axis],
        );
      } else {
        (staticPatch ??= {}).direction = patch.direction;
      }
    }
  }
  if (staticPatch) doc.setObjectLight(objectId, staticPatch);
}

/** Capture the current value of every animated channel as a keyframe at the playhead. */
export function keyframeSelection(): void {
  const { selectedIds, playheadMs } = useEditorStore.getState();
  const doc = useDocumentStore.getState();
  for (const id of selectedIds) {
    const obj = findObject(id);
    if (!obj) continue;
    const pose = evaluateObject(obj, playheadMs);
    for (const channel of animatedChannels(obj.tracks)) {
      let value: number | string;
      if (channel === 'color') value = pose.color;
      else if (channel === 'opacity') value = pose.opacity;
      else if (channel === 'text.writeOn') value = pose.writeOn ?? 1;
      else if (channel.startsWith('light.')) {
        if (!pose.light) continue; // light tracks without light params: nothing to key
        value = lightChannelValue(pose.light, channel);
      } else {
        value = pose[channel.split('.')[0] as 'position' | 'rotation' | 'scale'][
          Number(channel.split('.')[1])
        ];
      }
      doc.setChannelKeyframeValue(`object:${id}:${channel.replace('.', ':')}`, playheadMs, value);
    }
  }
}

import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type { ChannelKey, Transform, ValueKeyframe } from '../state/types';
import { evaluateObject } from './evaluate';

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

/** Capture the current value of every animated channel as a keyframe at the playhead. */
export function keyframeSelection(): void {
  const { selectedIds, playheadMs } = useEditorStore.getState();
  const doc = useDocumentStore.getState();
  for (const id of selectedIds) {
    const obj = findObject(id);
    if (!obj) continue;
    const pose = evaluateObject(obj, playheadMs);
    for (const channel of animatedChannels(obj.tracks)) {
      const value =
        channel === 'color'
          ? pose.color
          : channel === 'opacity'
            ? pose.opacity
            : pose[channel.split('.')[0] as 'position' | 'rotation' | 'scale'][
                Number(channel.split('.')[1])
              ];
      doc.setChannelKeyframeValue(`object:${id}:${channel.replace('.', ':')}`, playheadMs, value);
    }
  }
}

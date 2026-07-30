import type { Project } from './types';
import { evaluateExpr, varsMap } from './expr';

/**
 * Live variable bindings. A binding maps a stable "field path" key to an
 * expression string; whenever variables (or the binding) change, the
 * expression is re-evaluated and the resulting number written back into the
 * document model so the render/animation pipeline keeps reading plain numbers.
 *
 * Only fields whose displayed value equals the stored value (1:1 units) are
 * bindable: build-plate dimensions (mm) and object base transform components
 * (mm / degrees / unitless). Duration-style seconds<->ms fields are excluded.
 */

export type TransformChannel = 'position' | 'rotation' | 'scale';
export type SceneSettingField = 'buildPlateWidth' | 'buildPlateDepth' | 'gridSize';

export function objectTransformKey(
  objId: string,
  channel: TransformChannel,
  axis: number,
): string {
  return `object:${objId}:${channel}:${axis}`;
}

export function sceneSettingKey(sceneId: string, field: SceneSettingField): string {
  return `scene:${sceneId}:${field}`;
}

function findObjectAnyScene(project: Project, objId: string) {
  for (const scene of project.scenes) {
    const obj = scene.objects.find((o) => o.id === objId);
    if (obj) return obj;
  }
  return undefined;
}

/** Writes an evaluated value into the slot addressed by a binding key. */
export function writeBoundValue(project: Project, key: string, value: number): void {
  const parts = key.split(':');
  if (parts[0] === 'scene') {
    const scene = project.scenes.find((s) => s.id === parts[1]);
    if (!scene) return;
    const field = parts[2] as SceneSettingField;
    if (
      field === 'buildPlateWidth' ||
      field === 'buildPlateDepth' ||
      field === 'gridSize'
    ) {
      scene.settings[field] = value;
    }
  } else if (parts[0] === 'object') {
    const obj = findObjectAnyScene(project, parts[1]);
    if (!obj) return;
    const channel = parts[2] as TransformChannel;
    const axis = Number(parts[3]);
    if (channel === 'position' || channel === 'rotation' || channel === 'scale') {
      if (axis >= 0 && axis <= 2) obj.transform[channel][axis] = value;
    }
  }
}

/**
 * Re-evaluates the *scene-setting* bindings and writes results into the project.
 * Object-transform bindings are NOT handled here — they may depend on `time` or
 * keyframed variables and are applied per frame in the pose pipeline
 * (see objectBindingOverrides). This runs only when variables change.
 */
export function recomputeBindings(project: Project): void {
  const vars = varsMap(project.variables ?? []);
  const bindings = project.bindings ?? {};
  for (const key of Object.keys(bindings)) {
    if (!key.startsWith('scene:')) continue;
    const v = evaluateExpr(bindings[key], vars);
    if (v != null) writeBoundValue(project, key, v);
  }
}

/**
 * Per-axis transform overrides for one object, evaluated from its bindings
 * against the resolved variable map (which includes `time`). Returned per
 * channel/axis so the pose pipeline can apply them on top of keyframes.
 */
export function objectBindingOverrides(
  bindings: Record<string, string>,
  objId: string,
  vars: Record<string, number>,
): Partial<Record<TransformChannel, Partial<Record<number, number>>>> {
  const prefix = `object:${objId}:`;
  const out: Partial<Record<TransformChannel, Partial<Record<number, number>>>> = {};
  for (const key of Object.keys(bindings)) {
    if (!key.startsWith(prefix)) continue;
    const parts = key.split(':');
    const channel = parts[2] as TransformChannel;
    const axis = Number(parts[3]);
    if (channel !== 'position' && channel !== 'rotation' && channel !== 'scale') continue;
    const v = evaluateExpr(bindings[key], vars);
    if (v == null) continue;
    (out[channel] ??= {})[axis] = v;
  }
  return out;
}

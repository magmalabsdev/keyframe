import {
  defaultIdle,
  defaultTransition,
  isFormTransition,
  type SceneObject,
  type TransitionType,
  type Vec3,
} from '../state/types';
import { objectBindingOverrides } from '../state/bindings';
import { evaluateObject, isObjectActive } from './evaluate';

/** Active "form" transition: which edge, and assemble progress (0=scattered, 1=assembled). */
export interface FragmentState {
  which: 'start' | 'end';
  progress: number;
}

/** Per-frame context for resolving time-dependent variable bindings. */
export interface PoseContext {
  bindings: Record<string, string>;
  /** Resolved variable values at this time (includes `time`). */
  vars: Record<string, number>;
}

/** The full visual state of an object at a time: keyframes + idle + transitions. */
export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /** Keyframed/base material opacity (before opacityMul). */
  opacity: number;
  /** Multiplier applied to opacity by idle/transition effects (fade/flicker). */
  opacityMul: number;
  visible: boolean;
  color: string;
  /** Set when a chunked "form" transition is active; drives fragment rendering. */
  fragment: FragmentState | null;
}

function clamp01(p: number): number {
  return Math.max(0, Math.min(1, p));
}

function easeOutBack(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

/** Transition factor for progress p (0 = hidden/initial, 1 = fully present). */
function transitionFactor(
  type: TransitionType,
  pRaw: number,
): { scaleMul: number; opacityMul: number } {
  const p = clamp01(pRaw);
  // Form transitions render as chunks (handled by the fragment renderer), so
  // they leave the underlying transform untouched here.
  if (isFormTransition(type)) return { scaleMul: 1, opacityMul: 1 };
  switch (type) {
    case 'pop':
      return { scaleMul: Math.max(0, easeOutBack(p)), opacityMul: clamp01(p * 3) };
    case 'fade':
      return { scaleMul: 1, opacityMul: p };
    case 'digital':
      return {
        scaleMul: 0.92 + 0.08 * p,
        opacityMul: clamp01(p) * (0.55 + 0.45 * Math.sin(p * 38)),
      };
    case 'flicker':
      return { scaleMul: 1, opacityMul: p * (Math.sin(p * 28) > -0.25 ? 1 : 0.15) };
    default:
      return { scaleMul: 1, opacityMul: 1 };
  }
}

export function poseObjectAtTime(
  object: SceneObject,
  timeMs: number,
  ctx?: PoseContext,
): Pose {
  const base = evaluateObject(object, timeMs);
  const active = isObjectActive(object, timeMs);
  const position = base.position.slice() as Vec3;
  let rotation = base.rotation.slice() as Vec3;
  let scale = base.scale.slice() as Vec3;
  let opacityMul = 1;
  let fragment: FragmentState | null = null;

  // Variable bindings override keyframed/base transform channels (binding > keyframe > base).
  if (ctx && ctx.bindings) {
    const ov = objectBindingOverrides(ctx.bindings, object.id, ctx.vars);
    if (ov.position) for (const a in ov.position) position[+a] = ov.position[+a]!;
    if (ov.rotation) for (const a in ov.rotation) rotation[+a] = ov.rotation[+a]!;
    if (ov.scale) for (const a in ov.scale) scale[+a] = ov.scale[+a]!;
  }

  const { startMs: start, endMs: end } = object.lifetime;

  if (active) {
    const idle = object.idle ?? defaultIdle();
    if (idle.type !== 'none') {
      const elapsed = (timeMs - start) / 1000; // seconds
      const s = idle.speed || 1;
      if (idle.type === 'rotate') {
        const axis = idle.axis === 'x' ? 0 : idle.axis === 'y' ? 1 : 2;
        rotation = [...rotation] as Vec3;
        rotation[axis] += (elapsed * s * 90) % 360;
      } else if (idle.type === 'pulse') {
        const f = 1 + 0.12 * Math.sin(elapsed * s * Math.PI * 2);
        scale = [scale[0] * f, scale[1] * f, scale[2] * f];
      } else if (idle.type === 'wiggle') {
        const a = 12 * Math.sin(elapsed * s * Math.PI * 3);
        rotation = [rotation[0] + 0.5 * a, rotation[1], rotation[2] + a];
      } else if (idle.type === 'flicker') {
        const n =
          0.5 + 0.5 * Math.sin(elapsed * s * 22) * Math.sin(elapsed * s * 13.7 + 1.3);
        opacityMul *= n > 0.2 ? 1 : 0.3;
      }
    }

    const startA = object.startAnim ?? defaultTransition();
    if (startA.type !== 'none' && timeMs < start + startA.durationMs) {
      const p = startA.durationMs > 0 ? (timeMs - start) / startA.durationMs : 1;
      const f = transitionFactor(startA.type, p);
      scale = [scale[0] * f.scaleMul, scale[1] * f.scaleMul, scale[2] * f.scaleMul];
      opacityMul *= f.opacityMul;
      if (isFormTransition(startA.type)) fragment = { which: 'start', progress: clamp01(p) };
    }
    const endA = object.endAnim ?? defaultTransition();
    if (endA.type !== 'none' && timeMs > end - endA.durationMs) {
      const p = endA.durationMs > 0 ? (end - timeMs) / endA.durationMs : 1;
      const f = transitionFactor(endA.type, p);
      scale = [scale[0] * f.scaleMul, scale[1] * f.scaleMul, scale[2] * f.scaleMul];
      opacityMul *= f.opacityMul;
      if (isFormTransition(endA.type)) fragment = { which: 'end', progress: clamp01(p) };
    }
  }

  return {
    position,
    rotation,
    scale,
    opacity: base.opacity,
    opacityMul,
    visible: object.visible && active,
    color: base.color,
    fragment,
  };
}

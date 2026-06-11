import {
  defaultIdle,
  defaultTransition,
  type SceneObject,
  type TransitionType,
  type Vec3,
} from '../state/types';
import { evaluateObject, isObjectActive } from './evaluate';

/** The full visual state of an object at a time: keyframes + idle + transitions. */
export interface Pose {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /** Multiplier applied to the object's material opacity (fade/flicker). */
  opacityMul: number;
  visible: boolean;
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

export function poseObjectAtTime(object: SceneObject, timeMs: number): Pose {
  const base = evaluateObject(object, timeMs);
  const active = isObjectActive(object, timeMs);
  const position = base.position.slice() as Vec3;
  let rotation = base.rotation.slice() as Vec3;
  let scale = base.scale.slice() as Vec3;
  let opacityMul = 1;

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
    }
    const endA = object.endAnim ?? defaultTransition();
    if (endA.type !== 'none' && timeMs > end - endA.durationMs) {
      const p = endA.durationMs > 0 ? (end - timeMs) / endA.durationMs : 1;
      const f = transitionFactor(endA.type, p);
      scale = [scale[0] * f.scaleMul, scale[1] * f.scaleMul, scale[2] * f.scaleMul];
      opacityMul *= f.opacityMul;
    }
  }

  return { position, rotation, scale, opacityMul, visible: object.visible && active };
}

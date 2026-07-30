import { describe, it, expect } from 'vitest';
import {
  ease,
  evaluateTrack,
  evaluateColorTrack,
  evaluateObject,
  evaluateCamera,
  isObjectActive,
} from './evaluate';
import type { Easing, SceneObject, Tracks, ValueKeyframe } from '../state/types';

function vk(timeMs: number, value: number | string, interpolation: Easing = 'linear'): ValueKeyframe {
  return { id: `k${timeMs}`, timeMs, value, interpolation };
}

describe('ease', () => {
  it('linear is identity at endpoints and midpoint', () => {
    expect(ease(0, 'linear')).toBe(0);
    expect(ease(1, 'linear')).toBe(1);
    expect(ease(0.5, 'linear')).toBe(0.5);
  });
  it('step holds the from-value', () => {
    expect(ease(0.99, 'step')).toBe(0);
  });
  it('easeInOut is symmetric around 0.5', () => {
    expect(ease(0.5, 'easeInOut')).toBeCloseTo(0.5, 5);
    expect(ease(0.25, 'easeInOut') + ease(0.75, 'easeInOut')).toBeCloseTo(1, 5);
  });
});

describe('evaluateTrack', () => {
  it('returns the fallback for an empty/undefined track', () => {
    expect(evaluateTrack(undefined, 100, 7)).toBe(7);
    expect(evaluateTrack([], 100, 7)).toBe(7);
  });

  it('clamps before the first and after the last keyframe', () => {
    const t = [vk(1000, 10), vk(2000, 20)];
    expect(evaluateTrack(t, 0, 0)).toBe(10);
    expect(evaluateTrack(t, 5000, 0)).toBe(20);
  });

  it('linearly interpolates and selects the right segment', () => {
    const t = [vk(0, 0), vk(1000, 10), vk(2000, 30)];
    expect(evaluateTrack(t, 500, 0)).toBeCloseTo(5, 5);
    expect(evaluateTrack(t, 1500, 0)).toBeCloseTo(20, 5);
  });

  it('honors the from-keyframe easing (step holds)', () => {
    const t = [vk(0, 0, 'step'), vk(1000, 100)];
    expect(evaluateTrack(t, 500, 0)).toBe(0);
    expect(evaluateTrack(t, 1000, 0)).toBe(100);
  });
});

describe('evaluateColorTrack', () => {
  it('interpolates hex colors', () => {
    const t = [vk(1000, '#000000'), vk(2000, '#ffffff')];
    expect(evaluateColorTrack(t, 1500, '#888888')).toBe('#808080');
    expect(evaluateColorTrack(undefined, 1500, '#ff0000')).toBe('#ff0000');
  });
});

describe('evaluateObject (per-channel tracks)', () => {
  const base: SceneObject = {
    id: 'o',
    name: 'o',
    type: 'mesh',
    parentId: null,
    assetId: 'a',
    visible: true,
    lifetime: { startMs: 0, endMs: 4000 },
    transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#abcdef', opacity: 0.5, metalness: 0, roughness: 1 },
  };

  it('falls back to the base transform/material when a channel is unkeyed', () => {
    const p = evaluateObject(base, 1000);
    expect(p.position).toEqual([1, 2, 3]);
    expect(p.color).toBe('#abcdef');
    expect(p.opacity).toBe(0.5);
  });

  it('animates channels independently', () => {
    const obj: SceneObject = {
      ...base,
      tracks: { 'position.0': [vk(0, 0), vk(1000, 100)] },
    };
    // x animates; y/z stay at base.
    expect(evaluateObject(obj, 500).position[0]).toBeCloseTo(50, 5);
    expect(evaluateObject(obj, 500).position[1]).toBe(2);
    expect(evaluateObject(obj, 500).position[2]).toBe(3);
  });

  it('omits light values for objects without light params', () => {
    expect(evaluateObject(base, 1000).light).toBeUndefined();
  });
});

describe('evaluateObject (light channels)', () => {
  const lit: SceneObject = {
    id: 'l',
    name: 'l',
    type: 'light',
    parentId: null,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: 4000 },
    transform: { position: [0, 0, 800], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#ffffff', opacity: 1, metalness: 0, roughness: 1 },
    light: {
      enabled: true,
      color: '#ffffff',
      intensity: 3,
      spreadDeg: 130,
      softness: 0.35,
      direction: [0, 0, -1],
    },
  };

  it('falls back to base light params when unkeyed', () => {
    const p = evaluateObject(lit, 1000);
    expect(p.light).toEqual({
      color: '#ffffff',
      intensity: 3,
      spreadDeg: 130,
      softness: 0.35,
      direction: [0, 0, -1],
    });
  });

  it('interpolates scalar light channels', () => {
    const obj: SceneObject = {
      ...lit,
      tracks: {
        'light.intensity': [vk(0, 0), vk(1000, 10)],
        'light.spread': [vk(0, 40), vk(1000, 240)],
      },
    };
    const p = evaluateObject(obj, 500);
    expect(p.light!.intensity).toBeCloseTo(5, 5);
    expect(p.light!.spreadDeg).toBeCloseTo(140, 5);
    expect(p.light!.softness).toBe(0.35); // unkeyed axis stays at base
  });

  it('interpolates direction axes independently', () => {
    const obj: SceneObject = {
      ...lit,
      tracks: { 'light.direction.1': [vk(0, 0), vk(1000, 1)] },
    };
    const p = evaluateObject(obj, 500);
    expect(p.light!.direction).toEqual([0, 0.5, -1]);
  });

  it('interpolates the light color track', () => {
    const obj: SceneObject = {
      ...lit,
      tracks: { 'light.color': [vk(0, '#000000'), vk(1000, '#ffffff')] },
    };
    expect(evaluateObject(obj, 500).light!.color).toBe('#808080');
  });
});

describe('evaluateCamera', () => {
  it('returns default when tracks are empty', () => {
    const def = { position: [0, 0, 1200] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    expect(evaluateCamera(def, {}, 500)).toEqual(def);
  });
  it('interpolates position and target independently, per axis', () => {
    const def = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const tracks: Tracks = {
      'position.0': [vk(0, 0), vk(1000, 100)],
      'target.1': [vk(0, 0), vk(1000, 20)],
    };
    const pose = evaluateCamera(def, tracks, 500);
    expect(pose.position[0]).toBeCloseTo(50, 5);
    // Untracked axes fall back to the default, unaffected by the animated ones.
    expect(pose.position[1]).toBe(0);
    expect(pose.target[1]).toBeCloseTo(10, 5);
    expect(pose.target[0]).toBe(0);
  });
});

describe('isObjectActive', () => {
  const obj = {
    lifetime: { startMs: 1000, endMs: 3000 },
  } as SceneObject;
  it('is active within its lifetime, inactive outside', () => {
    expect(isObjectActive(obj, 500)).toBe(false);
    expect(isObjectActive(obj, 2000)).toBe(true);
    expect(isObjectActive(obj, 3500)).toBe(false);
  });
});

describe('evaluateObject write-on', () => {
  const textObj: SceneObject = {
    id: 't',
    name: 't',
    type: 'text',
    parentId: null,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: 4000 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#fff', opacity: 1, metalness: 0, roughness: 1 },
    text: {
      text: 'Hi',
      fontSize: 40,
      depth: 10,
      align: 'center',
      letterSpacing: 0,
      lineHeight: 1.15,
      writeOn: 0.5,
    },
  };

  it('uses the base writeOn param when there is no track', () => {
    expect(evaluateObject(textObj, 1000).writeOn).toBe(0.5);
  });

  it('evaluates and clamps the text.writeOn track', () => {
    const obj: SceneObject = {
      ...textObj,
      tracks: { 'text.writeOn': [vk(0, 0), vk(1000, 2)] },
    };
    expect(evaluateObject(obj, 500).writeOn).toBeCloseTo(1, 5); // clamped
    expect(evaluateObject(obj, 250).writeOn).toBeCloseTo(0.5, 5);
  });

  it('is present for text surfaces and absent for plain meshes', () => {
    const surface: SceneObject = {
      ...textObj,
      type: 'surface',
      text: undefined,
      surface: {
        points: [
          [-10, -10],
          [10, -10],
          [0, 10],
        ],
        content: 'text',
        writeOn: 0.25,
      },
    };
    expect(evaluateObject(surface, 0).writeOn).toBe(0.25);
    const plain: SceneObject = { ...textObj, type: 'mesh', text: undefined };
    expect(evaluateObject(plain, 0).writeOn).toBeUndefined();
  });

  it('defaults to fully revealed when no base value is set', () => {
    const obj: SceneObject = { ...textObj, text: { ...textObj.text!, writeOn: undefined } };
    expect(evaluateObject(obj, 0).writeOn).toBe(1);
  });
});

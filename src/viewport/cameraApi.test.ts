import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  clipPlanesFor,
  safeDistance,
  recenteredLookAt,
  orientationAngles,
  targetFromAngles,
  MIN_DISTANCE,
  MAX_DISTANCE,
} from './cameraApi';
import { zoomKeyToken, wheelDollySpeed } from './CameraRig';
import type { Vec3 } from '../state/types';

describe('clipPlanesFor', () => {
  it('keeps near well inside the scene at every usable distance', () => {
    for (const d of [MIN_DISTANCE, 100, 1200, 20000, MAX_DISTANCE]) {
      const { near, far } = clipPlanesFor(d);
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThan(d);
      expect(far).toBeGreaterThan(d);
    }
  });

  it('never lets near approach the old fixed 1mm trap up close', () => {
    // The bug: a fixed near=1 clipped anything within 1mm, so pushing into a
    // small part looked like zoom had stopped. Near must scale down with us.
    const { near } = clipPlanesFor(MIN_DISTANCE);
    expect(near).toBeLessThan(MIN_DISTANCE / 10);
  });

  it('is monotonic in distance', () => {
    const a = clipPlanesFor(100);
    const b = clipPlanesFor(10000);
    expect(b.near).toBeGreaterThanOrEqual(a.near);
    expect(b.far).toBeGreaterThan(a.far);
  });

  it('keeps the far/near ratio far below the 500000:1 that caused z-fighting', () => {
    for (const d of [MIN_DISTANCE, 1200, MAX_DISTANCE]) {
      const { near, far } = clipPlanesFor(d);
      expect(far / near).toBeLessThan(500_000);
    }
  });

  it('falls back to the default framing distance for unusable input', () => {
    const fallback = clipPlanesFor(1200);
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(clipPlanesFor(bad)).toEqual(fallback);
    }
  });
});

describe('safeDistance', () => {
  it('passes through real distances and replaces unusable ones', () => {
    expect(safeDistance(340)).toBe(340);
    // distance === 0 used to be swallowed by a falsy check and replaced with
    // 1000, making nav speed jump from ~0 to 1200/frame.
    expect(safeDistance(0)).toBe(1200);
    expect(safeDistance(NaN)).toBe(1200);
    expect(safeDistance(undefined)).toBe(1200);
  });
});

describe('recenteredLookAt', () => {
  /** A camera posed the way `update()` leaves it with a focal offset applied:
   * oriented by lookAt(target), then translated sideways by the offset. */
  function offsetCamera(offset: THREE.Vector3): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 12, 60000);
    cam.up.set(0, 0, 1);
    cam.position.set(0, 0, 1200);
    cam.lookAt(0, 0, 0);
    cam.position.add(offset.clone().applyQuaternion(cam.quaternion));
    cam.updateMatrixWorld();
    return cam;
  }

  it('reproduces the exact same view, so recentering is invisible', () => {
    const cam = offsetCamera(new THREE.Vector3(880, -320, 0));
    const before = cam.matrixWorldInverse.clone();

    const { position, target } = recenteredLookAt(cam, null, 1200);

    const rebuilt = new THREE.PerspectiveCamera(45, 16 / 9, 12, 60000);
    rebuilt.up.set(0, 0, 1);
    rebuilt.position.copy(position);
    rebuilt.lookAt(target);
    rebuilt.updateMatrixWorld();

    for (let i = 0; i < 16; i++) {
      expect(rebuilt.matrixWorldInverse.elements[i]).toBeCloseTo(before.elements[i], 5);
    }
  });

  it('puts the target dead ahead, which is what removes the zoom floor', () => {
    const cam = offsetCamera(new THREE.Vector3(880, -320, 0));
    const { position, target } = recenteredLookAt(cam, null, 1200);

    const toTarget = target.clone().sub(position).normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(toTarget.dot(forward)).toBeCloseTo(1, 5);
  });

  it('preserves the depth of the pivot the user orbited around', () => {
    const cam = offsetCamera(new THREE.Vector3(400, 0, 0));
    const pivot = new THREE.Vector3(0, 0, 0);
    const { position, target } = recenteredLookAt(cam, pivot, 9999);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const pivotDepth = pivot.clone().sub(position).dot(forward);
    expect(position.distanceTo(target)).toBeCloseTo(pivotDepth, 4);
  });

  it('clamps a pivot behind or beyond the camera into the usable range', () => {
    const cam = offsetCamera(new THREE.Vector3(0, 0, 0));
    const behind = recenteredLookAt(cam, new THREE.Vector3(0, 0, 5000), 1200);
    expect(behind.position.distanceTo(behind.target)).toBeCloseTo(MIN_DISTANCE, 6);

    const miles = recenteredLookAt(cam, new THREE.Vector3(0, 0, -1e9), 1200);
    expect(miles.position.distanceTo(miles.target)).toBeCloseTo(MAX_DISTANCE, 3);
  });
});

describe('zoomKeyToken', () => {
  it('resolves the same token whether or not Shift is held', () => {
    // The stuck-key bug: keydown reported '+', keyup reported '=' when Shift was
    // released first, so '+' never left the held set and zoom ran away.
    expect(zoomKeyToken({ code: 'Equal', key: '+' })).toBe('+');
    expect(zoomKeyToken({ code: 'Equal', key: '=' })).toBe('+');
    expect(zoomKeyToken({ code: 'Minus', key: '_' })).toBe('-');
    expect(zoomKeyToken({ code: 'Minus', key: '-' })).toBe('-');
  });

  it('handles the numpad and falls back to key when code is unavailable', () => {
    expect(zoomKeyToken({ code: 'NumpadAdd', key: '+' })).toBe('+');
    expect(zoomKeyToken({ code: 'NumpadSubtract', key: '-' })).toBe('-');
    expect(zoomKeyToken({ code: '', key: '=' })).toBe('+');
    expect(zoomKeyToken({ code: '', key: '_' })).toBe('-');
  });

  it('ignores non-zoom keys so movement keys still route normally', () => {
    expect(zoomKeyToken({ code: 'KeyW', key: 'w' })).toBeNull();
    expect(zoomKeyToken({ code: 'Space', key: ' ' })).toBeNull();
  });
});

describe('wheelDollySpeed', () => {
  /** The zoom step camera-controls actually applies: radius *= 0.95^(-d*speed). */
  function stepPerNotch(
    e: { deltaY: number; deltaMode: number; ctrlKey: boolean },
    isMac: boolean,
  ): number {
    const factor = isMac ? -1 : -3;
    const libDelta =
      e.deltaMode === 1 || e.ctrlKey ? e.deltaY / factor : e.deltaY / (factor * 10);
    return Math.abs(libDelta * wheelDollySpeed(e, isMac));
  }

  const chromeMac = { deltaY: 100, deltaMode: 0, ctrlKey: false };
  const firefox = { deltaY: 3, deltaMode: 1, ctrlKey: false };
  const pinch = { deltaY: 10, deltaMode: 0, ctrlKey: true };

  it('gives every browser, OS and gesture the same step per notch', () => {
    const reference = stepPerNotch(chromeMac, true);
    for (const [e, isMac] of [
      [chromeMac, false],
      [firefox, true],
      [firefox, false],
      [pinch, true],
      [pinch, false],
    ] as const) {
      // Before: Firefox's line-mode notch zoomed ~3x less than Chrome's, and a
      // bad navigator.platform sniff swung the rate by another 3x.
      expect(stepPerNotch(e, isMac)).toBeCloseTo(reference, 4);
    }
  });

  it('scales with how far the user actually scrolled', () => {
    const one = stepPerNotch(chromeMac, true);
    const three = stepPerNotch({ ...chromeMac, deltaY: 300 }, true);
    expect(three).toBeCloseTo(one * 3, 4);
  });

  it('is direction-agnostic', () => {
    expect(stepPerNotch({ ...chromeMac, deltaY: -100 }, true)).toBeCloseTo(
      stepPerNotch(chromeMac, true),
      4,
    );
  });

  it('falls back safely on degenerate events', () => {
    for (const bad of [0, NaN]) {
      const s = wheelDollySpeed({ deltaY: bad, deltaMode: 0, ctrlKey: false }, true);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
  });
});

describe('orientationAngles / targetFromAngles', () => {
  it('reports the app default (looking straight down) as pitch -90', () => {
    const position: Vec3 = [0, 0, 1200];
    const target: Vec3 = [0, 0, 0];
    const { yawDeg, pitchDeg } = orientationAngles(position, target);
    expect(pitchDeg).toBeCloseTo(-90, 5);
    // Yaw is undefined at the gimbal pole; any value is fine as long as it's finite.
    expect(Number.isFinite(yawDeg)).toBe(true);
  });

  it('round-trips a non-degenerate direction through the forward/inverse pair', () => {
    const position: Vec3 = [100, -200, 300];
    const target: Vec3 = [500, 150, 50];
    const distance = Math.hypot(400, 350, -250);
    const { yawDeg, pitchDeg } = orientationAngles(position, target);
    const rebuilt = targetFromAngles(position, yawDeg, pitchDeg, distance);
    expect(rebuilt[0]).toBeCloseTo(target[0], 5);
    expect(rebuilt[1]).toBeCloseTo(target[1], 5);
    expect(rebuilt[2]).toBeCloseTo(target[2], 5);
  });

  it('round-trips at the straight-down gimbal case without producing NaN', () => {
    const position: Vec3 = [0, 0, 1200];
    const target: Vec3 = [0, 0, 0];
    const { yawDeg, pitchDeg } = orientationAngles(position, target);
    const rebuilt = targetFromAngles(position, yawDeg, pitchDeg, 1200);
    expect(rebuilt.every((n) => Number.isFinite(n))).toBe(true);
    expect(rebuilt[0]).toBeCloseTo(0, 4);
    expect(rebuilt[1]).toBeCloseTo(0, 4);
    expect(rebuilt[2]).toBeCloseTo(0, 4);
  });

  it('holds distance fixed when only yaw changes', () => {
    const position: Vec3 = [0, 0, 0];
    const target = targetFromAngles(position, 30, -20, 500);
    const rotated = targetFromAngles(position, 90, -20, 500);
    const distTarget = Math.hypot(...target.map((v, i) => v - position[i]));
    const distRotated = Math.hypot(...rotated.map((v, i) => v - position[i]));
    expect(distTarget).toBeCloseTo(500, 5);
    expect(distRotated).toBeCloseTo(500, 5);
  });

  it('falls back to level angles when position equals target', () => {
    const p: Vec3 = [10, 10, 10];
    expect(orientationAngles(p, p)).toEqual({ yawDeg: 0, pitchDeg: 0 });
  });

  it('clamps degenerate (zero/negative) distance to MIN_DISTANCE', () => {
    const position: Vec3 = [0, 0, 0];
    const target = targetFromAngles(position, 0, 0, 0);
    expect(Math.hypot(...target)).toBeCloseTo(MIN_DISTANCE, 5);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FRUSTUM_DEPTH,
  frustumHalfHeight,
  poseFrustum,
  unitFrustumPositions,
} from './frustumGeometry';
import { CAMERA_ASPECT, type CameraState } from '../state/types';

/** The frustum rig as CameraFrustum mounts it: a body group with a scaled child. */
function rig() {
  const body = new THREE.Group();
  const cone = new THREE.Group();
  body.add(cone);
  return { body, cone };
}

/** World position of the base centre (local +Z on the scaled cone). */
function baseCentre(body: THREE.Object3D, cone: THREE.Object3D): THREE.Vector3 {
  body.updateMatrixWorld(true);
  return new THREE.Vector3(0, 0, 1).applyMatrix4(cone.matrixWorld);
}

describe('unitFrustumPositions', () => {
  it('is 8 segments: apex-to-corner plus the base rectangle', () => {
    expect(unitFrustumPositions()).toHaveLength(8 * 2 * 3);
  });

  /**
   * Regression guard. `Object3D.lookAt` aims +Z at the target for anything that
   * is not a camera or light (it swaps its eye/target arguments), so a pyramid
   * built down -Z — the direction a camera actually looks — renders pointing
   * away from the subject.
   */
  it('puts the base on +Z, the axis lookAt aims at the target', () => {
    const p = unitFrustumPositions();
    const zs = new Set<number>();
    for (let i = 2; i < p.length; i += 3) zs.add(p[i]);
    expect([...zs].sort()).toEqual([0, 1]); // apex at 0, every corner at +1
  });
});

describe('frustumHalfHeight', () => {
  it('is tan(fov/2) * depth', () => {
    expect(frustumHalfHeight(90)).toBeCloseTo(FRUSTUM_DEPTH, 5);
    expect(frustumHalfHeight(45)).toBeCloseTo(165.69, 2);
  });

  it('grows with the field of view', () => {
    expect(frustumHalfHeight(15)).toBeLessThan(frustumHalfHeight(45));
    expect(frustumHalfHeight(45)).toBeLessThan(frustumHalfHeight(110));
  });
});

describe('poseFrustum', () => {
  const pose: CameraState = { position: [0, 0, 1200], target: [0, 0, 0] };

  it('opens toward the target, not away from it', () => {
    const { body, cone } = rig();
    poseFrustum(body, cone, pose, 45);
    // Camera at z=1200 looking down at the origin: the base must sit below the
    // apex, FRUSTUM_DEPTH closer to the target.
    expect(baseCentre(body, cone).z).toBeCloseTo(1200 - FRUSTUM_DEPTH, 3);
  });

  it('keeps the base centred on the view axis for an off-axis camera', () => {
    const { body, cone } = rig();
    poseFrustum(body, cone, { position: [500, -500, 800], target: [0, 0, 0] }, 45);
    const c = baseCentre(body, cone);
    const eye = new THREE.Vector3(500, -500, 800);
    const dir = new THREE.Vector3(0, 0, 0).sub(eye).normalize();
    const expected = eye.clone().addScaledVector(dir, FRUSTUM_DEPTH);
    expect(c.distanceTo(expected)).toBeLessThan(1e-3);
  });

  it('scales the cone to the lens and leaves the body unscaled', () => {
    const { body, cone } = rig();
    poseFrustum(body, cone, pose, 90);
    expect(cone.scale.y).toBeCloseTo(FRUSTUM_DEPTH, 3);
    expect(cone.scale.x).toBeCloseTo(FRUSTUM_DEPTH * CAMERA_ASPECT, 3);
    expect(cone.scale.z).toBe(FRUSTUM_DEPTH);
    expect(body.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('survives the degenerate straight-down pose without NaN', () => {
    // position -> target is parallel to the Z-up vector; three.js perturbs the
    // basis rather than producing NaN, and the default camera sits exactly here.
    const { body, cone } = rig();
    poseFrustum(body, cone, pose, 45);
    expect(body.quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(baseCentre(body, cone).toArray().every(Number.isFinite)).toBe(true);
  });
});

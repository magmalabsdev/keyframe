import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  composeRotation,
  projectOntoPlane,
  RingAngleTracker,
  shouldUseAngular,
  signedAngle,
} from './ringRotation';

const d2r = THREE.MathUtils.degToRad;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('projectOntoPlane', () => {
  it('removes the axis-parallel component', () => {
    const out = projectOntoPlane(v(3, 4, 5), v(0, 0, 1), new THREE.Vector3());
    expect(out.x).toBeCloseTo(3, 12);
    expect(out.y).toBeCloseTo(4, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  it('projects a point on the axis to zero', () => {
    const out = projectOntoPlane(v(0, 0, 7), v(0, 0, 1), new THREE.Vector3());
    expect(out.length()).toBeCloseTo(0, 12);
  });
});

describe('signedAngle round-trip', () => {
  const axes = [v(0, 0, 1), v(1, 0, 0), v(0, 1, 0), v(1, 1, 1).normalize()];
  const degrees = [5, -5, 90, -90, 179, -179];

  it('recovers the exact rotation, including sign', () => {
    for (const axis of axes) {
      // A start point guaranteed not to be parallel to the axis.
      const seed = Math.abs(axis.z) < 0.9 ? v(0, 0, 1) : v(1, 0, 0);
      const start = new THREE.Vector3().crossVectors(axis, seed).normalize().multiplyScalar(42);
      for (const deg of degrees) {
        const end = start.clone().applyAxisAngle(axis, d2r(deg));
        const a = projectOntoPlane(start, axis, new THREE.Vector3());
        const b = projectOntoPlane(end, axis, new THREE.Vector3());
        expect(signedAngle(a, b, axis)).toBeCloseTo(d2r(deg), 9);
      }
    }
  });
});

describe('RingAngleTracker unwrapping', () => {
  const axis = v(0, 0, 1);
  const start = v(100, 0, 0);

  it('accumulates monotonically well past a full turn', () => {
    // This is the reported bug: dragging a large rotation must keep winding in
    // the mouse direction rather than folding back at 180°.
    const tracker = new RingAngleTracker();
    expect(tracker.begin(start, axis)).toBe(true);

    let last = 0;
    let total = 0;
    for (let deg = 5; deg <= 720; deg += 5) {
      total = tracker.update(start.clone().applyAxisAngle(axis, d2r(deg)));
      expect(total).toBeGreaterThan(last);
      last = total;
    }
    expect(total).toBeCloseTo(d2r(720), 6);
  });

  it('winds negative for the opposite direction', () => {
    const tracker = new RingAngleTracker();
    tracker.begin(start, axis);
    let total = 0;
    for (let deg = -5; deg >= -540; deg -= 5) {
      total = tracker.update(start.clone().applyAxisAngle(axis, d2r(deg)));
    }
    expect(total).toBeCloseTo(d2r(-540), 6);
  });

  it("three's in-plane formula is NOT monotone — the reason this module exists", () => {
    // Regression guard: pointEnd.angleTo(pointStart) is bounded to [0, π], so it
    // reverses past a half turn. Swapping our solver for it would reintroduce
    // exactly the behavior the user reported.
    const angles: number[] = [];
    for (let deg = 5; deg <= 360; deg += 5) {
      angles.push(start.clone().applyAxisAngle(axis, d2r(deg)).angleTo(start));
    }
    const monotone = angles.every((a, i) => i === 0 || a > angles[i - 1]);
    expect(monotone).toBe(false);
  });

  it('refuses to start when the grab point lies on the axis', () => {
    const tracker = new RingAngleTracker();
    expect(tracker.begin(v(0, 0, 5), axis)).toBe(false);
    // And stays inert, so the caller can fall back to three's own math.
    expect(tracker.update(v(10, 0, 0))).toBe(0);
  });

  it('holds the last total for samples at the center, without NaN', () => {
    const tracker = new RingAngleTracker();
    tracker.begin(start, axis);
    const before = tracker.update(start.clone().applyAxisAngle(axis, d2r(30)));
    const during = tracker.update(v(0, 0, 0));
    expect(during).toBe(before);
    expect(Number.isNaN(during)).toBe(false);
  });

  it('reset clears the accumulated angle', () => {
    const tracker = new RingAngleTracker();
    tracker.begin(start, axis);
    tracker.update(start.clone().applyAxisAngle(axis, d2r(45)));
    tracker.reset();
    expect(tracker.total).toBe(0);
  });
});

describe('shouldUseAngular', () => {
  const eye = v(0, 0, 1);

  it('is true when the ring faces the camera (the default top-view Z ring)', () => {
    expect(shouldUseAngular(v(0, 0, 1), eye)).toBe(true);
    expect(shouldUseAngular(v(0, 0, -1), eye)).toBe(true);
  });

  it('is true for near-parallel axes, where the tangent method is noisy', () => {
    for (const deg of [10, 40]) {
      const axis = v(0, 0, 1).applyAxisAngle(v(1, 0, 0), d2r(deg));
      expect(shouldUseAngular(axis, eye)).toBe(true);
    }
  });

  it('is false when the ring is edge-on, leaving three’s math untouched', () => {
    for (const deg of [60, 90]) {
      const axis = v(0, 0, 1).applyAxisAngle(v(1, 0, 0), d2r(deg));
      expect(shouldUseAngular(axis, eye)).toBe(false);
    }
  });
});

describe('composeRotation', () => {
  const axis = v(0, 0, 1);
  const qStart = new THREE.Quaternion().setFromEuler(new THREE.Euler(d2r(10), d2r(20), d2r(30)));

  it('local matches quaternionStart · R(axis, angle)', () => {
    const expected = qStart
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(axis, d2r(50)))
      .normalize();
    const out = composeRotation(
      'local',
      qStart,
      axis,
      new THREE.Quaternion(),
      d2r(50),
      new THREE.Quaternion(),
    );
    expect(out.angleTo(expected)).toBeCloseTo(0, 9);
  });

  it('world matches R(parentInv · axis, angle) · quaternionStart', () => {
    const parentInv = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, d2r(35), 0))
      .invert();
    const expected = new THREE.Quaternion()
      .setFromAxisAngle(axis.clone().applyQuaternion(parentInv), d2r(50))
      .multiply(qStart)
      .normalize();
    const out = composeRotation(
      'world',
      qStart,
      axis,
      parentInv,
      d2r(50),
      new THREE.Quaternion(),
    );
    expect(out.angleTo(expected)).toBeCloseTo(0, 9);
  });

  it('leaves the rotation axis invariant (R(A,θ)·A = A)', () => {
    const out = composeRotation(
      'local',
      new THREE.Quaternion(),
      axis,
      new THREE.Quaternion(),
      d2r(123),
      new THREE.Quaternion(),
    );
    const moved = axis.clone().applyQuaternion(out);
    expect(moved.distanceTo(axis)).toBeCloseTo(0, 9);
  });

  it('returns a normalized quaternion', () => {
    const out = composeRotation(
      'world',
      qStart,
      axis,
      new THREE.Quaternion(),
      d2r(700),
      new THREE.Quaternion(),
    );
    expect(out.length()).toBeCloseTo(1, 9);
  });
});

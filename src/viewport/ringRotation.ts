/**
 * Angular rotation solver for the gizmo's rotation rings.
 *
 * three's TransformControls derives the rotation angle by projecting the screen
 * drag onto a tangent vector (`axis × eye`). That is well-conditioned only when
 * the ring is edge-on; when the ring faces the camera the cross product goes to
 * zero, normalizing it amplifies float noise, and the rotation jitters and
 * reverses. This app hits that constantly: the world is Z-up and the default
 * camera looks straight down -Z, so the Z ring — the one you reach for to spin
 * a part on the build plate — sits on the singularity.
 *
 * This module measures the angle the other way: project the grab point and the
 * current point onto the plane perpendicular to the ring axis and take the
 * signed angle between them. That is well-conditioned exactly where the tangent
 * method fails, so the two are complementary and `shouldUseAngular` picks
 * between them once per drag.
 *
 * Angles accumulate from the previous sample rather than from the grab point,
 * so the total is unbounded and monotone in the mouse direction — dragging
 * several turns keeps winding instead of reversing at 180°.
 *
 * Deliberately free of three-stdlib/React imports so it can be unit-tested.
 */
import * as THREE from 'three';

/**
 * Below this projected radius (in world units) the cursor is effectively on the
 * rotation axis, where the angle is meaningless and noise could inject a
 * spurious half-turn. Samples inside it are ignored.
 */
const MIN_RADIUS = 1e-6;

/** Component of `p` perpendicular to `axis` (which must be normalized). */
export function projectOntoPlane(
  p: THREE.Vector3,
  axis: THREE.Vector3,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.copy(p).addScaledVector(axis, -p.dot(axis));
}

/**
 * Signed angle that rotates `a` onto `b` about `axis`, in (-π, π].
 * `a` and `b` must already lie in the plane perpendicular to `axis`.
 */
export function signedAngle(a: THREE.Vector3, b: THREE.Vector3, axis: THREE.Vector3): number {
  const cross = new THREE.Vector3().crossVectors(a, b);
  return Math.atan2(cross.dot(axis), a.dot(b));
}

/**
 * Whether the angular solver should drive this drag. True when the ring is more
 * face-on than edge-on (axis within 45° of the view direction), which is
 * exactly where three's tangent projection is ill-conditioned.
 */
export function shouldUseAngular(axisWorld: THREE.Vector3, eye: THREE.Vector3): boolean {
  return Math.abs(axisWorld.dot(eye)) > Math.SQRT1_2;
}

/**
 * Accumulates an unwrapped rotation angle across a drag. Each sample
 * contributes the (small) signed angle since the previous one, so the running
 * total winds past ±180° instead of folding back.
 */
export class RingAngleTracker {
  private readonly axis = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private accumulated = 0;
  private active = false;

  /**
   * Starts a drag. Returns false when the grab point lies on the rotation axis
   * (no usable direction), in which case the caller should leave three's own
   * math alone.
   */
  begin(pointStart: THREE.Vector3, axisWorld: THREE.Vector3): boolean {
    this.axis.copy(axisWorld).normalize();
    projectOntoPlane(pointStart, this.axis, this.prev);
    this.accumulated = 0;
    this.active = this.prev.length() > MIN_RADIUS;
    return this.active;
  }

  /** Feeds the current drag point, returning the accumulated angle in radians. */
  update(pointEnd: THREE.Vector3): number {
    if (!this.active) return this.accumulated;
    projectOntoPlane(pointEnd, this.axis, this.scratch);
    // Near the center the direction is noise; hold the last good total.
    if (this.scratch.length() <= MIN_RADIUS) return this.accumulated;
    this.accumulated += signedAngle(this.prev, this.scratch, this.axis);
    this.prev.copy(this.scratch);
    return this.accumulated;
  }

  get total(): number {
    return this.accumulated;
  }

  reset(): void {
    this.active = false;
    this.accumulated = 0;
  }
}

/**
 * Builds the object's quaternion for a rotation of `angle` about `unitAxis`,
 * mirroring how TransformControls composes each space:
 *   local → quaternionStart · R(axis, angle)
 *   world → R(parentInv · axis, angle) · quaternionStart
 * Always recomputed from the frozen start quaternion, so it never drifts.
 */
export function composeRotation(
  space: 'local' | 'world',
  quaternionStart: THREE.Quaternion,
  unitAxis: THREE.Vector3,
  parentQuaternionInv: THREE.Quaternion,
  angle: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const delta = new THREE.Quaternion();
  if (space === 'local') {
    delta.setFromAxisAngle(unitAxis, angle);
    out.copy(quaternionStart).multiply(delta);
  } else {
    const axis = unitAxis.clone().applyQuaternion(parentQuaternionInv);
    delta.setFromAxisAngle(axis, angle);
    out.copy(delta).multiply(quaternionStart);
  }
  return out.normalize();
}

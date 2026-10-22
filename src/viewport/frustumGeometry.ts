import * as THREE from 'three';
import type { CameraState } from '../state/types';
import { CAMERA_ASPECT } from '../state/types';

/**
 * How far down the view axis the frustum's base sits, in mm. Fixed rather than
 * screen-relative, matching the light's arrow (also hardcoded in mm); 400mm
 * reads clearly against the 1600mm build plate without swallowing the scene.
 */
export const FRUSTUM_DEPTH = 400;

/**
 * Unit pyramid pointing along local +Z: apex at the origin, base a 2x2 square at
 * z = +1. Scaling by (halfWidth, halfHeight, depth) turns it into the real
 * frustum, so the geometry is built once and never rebuilt as the FOV animates.
 *
 * +Z rather than the -Z a camera looks down, because `Object3D.lookAt` reverses
 * its eye/target arguments for everything that is not a camera or light: it aims
 * the object's *+Z* at the target. Building this down -Z points the pyramid
 * directly away from whatever the camera is framing.
 */
export function unitFrustumPositions(): Float32Array {
  const corners: [number, number, number][] = [
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const segments: [number, number, number][][] = [];
  // Apex to each corner, then the base rectangle.
  for (const corner of corners) segments.push([[0, 0, 0], corner]);
  for (let i = 0; i < 4; i++) segments.push([corners[i], corners[(i + 1) % 4]]);
  return new Float32Array(segments.flat().flat());
}

/** Half-height of the frustum's base for a vertical FOV, in mm. */
export function frustumHalfHeight(fovDeg: number): number {
  return Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * FRUSTUM_DEPTH;
}

/**
 * Places `body` at the camera and aims it at the camera's target, and scales
 * `cone` to the lens. Split so the body cube stays square while only the pyramid
 * takes the FOV scaling.
 */
export function poseFrustum(
  body: THREE.Object3D,
  cone: THREE.Object3D,
  pose: CameraState,
  fovDeg: number,
): void {
  body.position.set(pose.position[0], pose.position[1], pose.position[2]);
  // Match the render camera's Z-up convention so the frame's horizon agrees
  // with what an export actually produces.
  body.up.set(0, 0, 1);
  body.lookAt(pose.target[0], pose.target[1], pose.target[2]);

  const halfH = frustumHalfHeight(fovDeg);
  cone.scale.set(halfH * CAMERA_ASPECT, halfH, FRUSTUM_DEPTH);
}

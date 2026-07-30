/**
 * Shared math for scene lights, used by both the React mount (SceneObjects
 * LightRig) and the per-frame pose driver (applyPose) so the two never drift.
 *
 * Spread <= 180 deg renders as a THREE.SpotLight (full cone angle = spread);
 * wider spreads render as an omnidirectional THREE.PointLight. Both are always
 * mounted and the inactive one is driven to intensity 0: three.js hashes
 * shader programs by visible-light count, so adding/removing light nodes (or
 * toggling their visibility) would recompile every material each time spread
 * animates across the boundary or a lifetime edge passes.
 */

/** Full spread angle above which a light is omnidirectional (point light). */
export const SPOT_MAX_SPREAD_DEG = 180;

export function isSpotSpread(spreadDeg: number): boolean {
  return spreadDeg <= SPOT_MAX_SPREAD_DEG;
}

/** SpotLight half-angle in radians, clamped to three's valid (0, PI/2] range. */
export function spotAngle(spreadDeg: number): number {
  const half = (spreadDeg / 2) * (Math.PI / 180);
  return Math.min(Math.max(half, 0.02), Math.PI / 2 - 1e-4);
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Emitter meshes glow: material emissiveIntensity per unit light intensity. */
export const EMISSIVE_PER_INTENSITY = 0.25;

/** Proxy sphere color while a light is off (hidden or outside its lifetime). */
export const PROXY_OFF_COLOR = '#5a5f6a';

import * as THREE from 'three';
import type { SceneObject } from '../state/types';
import type { Pose } from '../animation/pose';
import {
  EMISSIVE_PER_INTENSITY,
  PROXY_OFF_COLOR,
  clamp01,
  isSpotSpread,
  spotAngle,
} from './lightMath';

const d2r = THREE.MathUtils.degToRad;
const NEG_Z = new THREE.Vector3(0, 0, -1);
const _dirVec = new THREE.Vector3();

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Materials driven by `applyMaterialPose`: standard (lit meshes/surfaces) or
 *  basic (unlit surface text — see SceneObjects.SurfaceText). Both expose the
 *  color/opacity/transparent trio it needs. */
type ColoredMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

/**
 * The drawable material of a mesh. troika's text meshes expose an array when
 * outline props are set, in which case the last entry is the fill material.
 */
function resolveMaterial(mesh: THREE.Mesh): ColoredMaterial | undefined {
  const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (!m) return undefined;
  return (Array.isArray(m) ? m[m.length - 1] : m) as ColoredMaterial;
}

/** Drives a mesh's animated color and opacity, handling the transparency recompile. */
function applyMaterialPose(mesh: THREE.Mesh, color: string, opacity: number): void {
  const mat = resolveMaterial(mesh);
  if (!mat) return;
  const transparent = opacity < 1;
  // three.js only recompiles the program (enabling the blended/transparent
  // pass) when `transparent` changes AND needsUpdate is set. Without this,
  // the first opaque->transparent flip has no visible effect until a reload.
  // Track the last-applied value ourselves (in userData) rather than reading
  // mat.transparent: r3f may have already mutated that flag this frame, which
  // would hide the change from a plain comparison.
  if (mat.userData.transparent !== transparent) {
    mat.userData.transparent = transparent;
    mat.needsUpdate = true;
  }
  mat.opacity = opacity;
  mat.transparent = transparent;
  mat.color.set(color);
}

/**
 * A name -> Object3D lookup, built once per frame from a single scene traversal.
 * Using this instead of `THREE.Object3D.getObjectByName` (a full traversal per
 * call) turns the per-frame pose pass from O(N^2) into O(N) for large scenes.
 */
export type NameMap = Map<string, THREE.Object3D>;

/** Builds a name -> object map from one scene traversal. */
export function buildNameMap(threeScene: THREE.Object3D): NameMap {
  const map: NameMap = new Map();
  threeScene.traverse((o) => {
    if (o.name) map.set(o.name, o);
  });
  return map;
}

/**
 * Drives the chunked "form" transition meshes for one object, hiding the solid
 * mesh (and any extra node, e.g. a surface's troika text child) while chunks
 * are showing. Returns true when a fragment is active, in which case the caller
 * must leave the solid mesh alone.
 */
function applyFragmentPose(
  nameMap: NameMap,
  obj: SceneObject,
  pose: Pose,
  solid: THREE.Mesh | undefined,
  alsoHide?: THREE.Object3D,
): boolean {
  const fragStart = nameMap.get(`${obj.id}__fragStart`) as THREE.Mesh | undefined;
  const fragEnd = nameMap.get(`${obj.id}__fragEnd`) as THREE.Mesh | undefined;

  if (pose.fragment) {
    const active = pose.fragment.which === 'start' ? fragStart : fragEnd;
    const other = pose.fragment.which === 'start' ? fragEnd : fragStart;
    if (other) other.visible = false;
    if (!active) return false; // no chunks mounted: fall back to the solid mesh
    if (solid) solid.visible = false;
    if (alsoHide) alsoHide.visible = false;
    active.visible = true;
    const mat = active.material as THREE.MeshStandardMaterial;
    const u = mat.userData.uProgress as { value: number } | undefined;
    if (u) u.value = pose.fragment.progress;
    mat.color.set(pose.color);
    // Fade chunks in over the first part of the assemble so they pop into view.
    mat.opacity = obj.material.opacity * smoothstep(0, 0.35, pose.fragment.progress);
    return true;
  }

  if (fragStart) fragStart.visible = false;
  if (fragEnd) fragEnd.visible = false;
  return false;
}

/**
 * Imperatively drives one object's three.js group from an evaluated Pose.
 * Shared by the live animation loop and the video exporter so both render
 * keyframes, transitions, and chunked "form" transitions identically.
 */
export function applyObjectPose(
  nameMap: NameMap,
  obj: SceneObject,
  pose: Pose,
): void {
  const group = nameMap.get(obj.id);
  if (!group) return;

  // Light objects stay mounted+visible across lifetime/eye toggles and are
  // gated by intensity instead: hiding a light changes the visible-light
  // count, which recompiles every lit material in the scene.
  group.visible = obj.type === 'light' ? true : pose.visible;
  group.position.set(pose.position[0], pose.position[1], pose.position[2]);
  group.rotation.set(d2r(pose.rotation[0]), d2r(pose.rotation[1]), d2r(pose.rotation[2]));
  group.scale.set(pose.scale[0], pose.scale[1], pose.scale[2]);

  if (pose.light && (obj.type === 'light' || obj.light?.enabled)) {
    const light = pose.light;
    // Fade/flicker transitions dim emitted light along with the object.
    const effective = light.intensity * pose.opacityMul * (pose.visible ? 1 : 0);
    const useSpot = isSpotSpread(light.spreadDeg);
    const spot = nameMap.get(`${obj.id}__spot`) as THREE.SpotLight | undefined;
    if (spot) {
      spot.intensity = useSpot ? effective : 0;
      spot.angle = spotAngle(light.spreadDeg);
      spot.penumbra = clamp01(light.softness);
      spot.color.set(light.color);
    }
    const point = nameMap.get(`${obj.id}__point`) as THREE.PointLight | undefined;
    if (point) {
      point.intensity = useSpot ? 0 : effective;
      point.color.set(light.color);
    }
    _dirVec.set(light.direction[0], light.direction[1], light.direction[2]);
    if (_dirVec.lengthSq() < 1e-8) _dirVec.copy(NEG_Z);
    const target = nameMap.get(`${obj.id}__target`);
    if (target) target.position.copy(_dirVec);

    if (obj.type === 'light') {
      // Editor-only helpers: aim the direction arrow, tint the proxy sphere
      // (dimmed while the light is off). Selection tint wins (React sets it).
      const dir = nameMap.get(`${obj.id}__dir`);
      if (dir) dir.quaternion.setFromUnitVectors(NEG_Z, _dirVec.normalize());
      const proxy = nameMap.get(`${obj.id}__mesh`) as THREE.Mesh | undefined;
      const proxyMat = proxy?.material as THREE.MeshBasicMaterial | undefined;
      if (proxy && proxyMat && proxy.userData.selected !== true) {
        proxyMat.color.set(pose.visible ? light.color : PROXY_OFF_COLOR);
      }
    }
  }

  // Surfaces carry no assetId, so they are driven before the mesh path's
  // asset guard below. Non-text surfaces can fragment their polygon body; text
  // surfaces mount no chunks, so a stray form transition is a no-op.
  if (obj.type === 'surface') {
    const surface = obj.surface;
    const opacity = pose.opacity * pose.opacityMul;
    const isText = surface?.content === 'text';
    const body = nameMap.get(`${obj.id}__mesh`) as THREE.Mesh | undefined;
    const glyphs = nameMap.get(`${obj.id}__text`) as THREE.Mesh | undefined;
    // Hide the troika text along with the body: its quads aren't fragmentable,
    // so leaving it up would float readable text over the scattering chunks.
    if (applyFragmentPose(nameMap, obj, pose, body, glyphs)) return;
    if (body) {
      body.visible = true;
      const showBg = surface?.showBackground ?? !isText;
      applyMaterialPose(
        body,
        isText ? (surface?.backgroundColor ?? '#000000') : pose.color,
        showBg ? opacity : 0,
      );
    }
    const text = glyphs;
    if (text) {
      text.visible = true;
      applyMaterialPose(text, pose.color, opacity);
      // Typewriter write-on: troika instances glyphs in string order, so
      // clamping instanceCount reveals a prefix. Purely synchronous (no
      // re-layout), so the video exporter's frame loop gets it too. Restored
      // to the full count at writeOn=1 in case an earlier frame clamped it.
      if (pose.writeOn !== undefined) {
        const info = (
          text as unknown as {
            textRenderInfo?: { glyphAtlasIndices?: { length: number } };
          }
        ).textRenderInfo;
        const total = info?.glyphAtlasIndices?.length ?? 0;
        const geom = text.geometry as THREE.InstancedBufferGeometry;
        if (total > 0 && 'instanceCount' in geom) {
          geom.instanceCount =
            pose.writeOn >= 1 ? total : Math.round(clamp01(pose.writeOn) * total);
        }
      }
    }
    return;
  }

  // Glyphs (3D text characters) carry no assetId; their reveal is already
  // folded into pose.visible. Their form transition may be their own or
  // inherited from the parent text (resolved in pose.ts).
  if (obj.type === 'glyph') {
    const mesh = nameMap.get(`${obj.id}__mesh`) as THREE.Mesh | undefined;
    if (applyFragmentPose(nameMap, obj, pose, mesh)) return;
    if (mesh) {
      mesh.visible = true;
      applyMaterialPose(mesh, pose.color, pose.opacity * pose.opacityMul);
    }
    return;
  }

  // A 'text' parent has no mesh of its own — it's a bare group whose glyph
  // children do the drawing (and inherit its form transition via pose.ts), so
  // it falls through here with nothing to drive.
  if (!obj.assetId) return;

  const mesh = nameMap.get(`${obj.id}__mesh`) as THREE.Mesh | undefined;
  if (applyFragmentPose(nameMap, obj, pose, mesh)) return;
  if (mesh) {
    mesh.visible = true;
    applyMaterialPose(mesh, pose.color, pose.opacity * pose.opacityMul);
    // Always a lit mesh here (never surface text), so emissive is available.
    const mat = resolveMaterial(mesh) as THREE.MeshStandardMaterial | undefined;
    // Emitter glow (uniform-only writes; no needsUpdate required). The
    // selection highlight also lives in the emissive slot and wins.
    if (mat && pose.light && obj.light?.enabled && mesh.userData.selected !== true) {
      mat.emissive.set(pose.light.color);
      mat.emissiveIntensity =
        EMISSIVE_PER_INTENSITY * pose.light.intensity * pose.opacityMul;
    }
  }
}

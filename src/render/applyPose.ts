import * as THREE from 'three';
import type { SceneObject } from '../state/types';
import type { Pose } from '../animation/pose';

const d2r = THREE.MathUtils.degToRad;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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

  group.visible = pose.visible;
  group.position.set(pose.position[0], pose.position[1], pose.position[2]);
  group.rotation.set(d2r(pose.rotation[0]), d2r(pose.rotation[1]), d2r(pose.rotation[2]));
  group.scale.set(pose.scale[0], pose.scale[1], pose.scale[2]);

  if (!obj.assetId) return;

  const mesh = nameMap.get(`${obj.id}__mesh`) as THREE.Mesh | undefined;
  const fragStart = nameMap.get(`${obj.id}__fragStart`) as THREE.Mesh | undefined;
  const fragEnd = nameMap.get(`${obj.id}__fragEnd`) as THREE.Mesh | undefined;

  if (pose.fragment) {
    const active = pose.fragment.which === 'start' ? fragStart : fragEnd;
    const other = pose.fragment.which === 'start' ? fragEnd : fragStart;
    if (other) other.visible = false;
    if (mesh) mesh.visible = false;
    if (active) {
      active.visible = true;
      const mat = active.material as THREE.MeshStandardMaterial;
      const u = mat.userData.uProgress as { value: number } | undefined;
      if (u) u.value = pose.fragment.progress;
      mat.color.set(pose.color);
      // Fade chunks in over the first part of the assemble so they pop into view.
      mat.opacity = obj.material.opacity * smoothstep(0, 0.35, pose.fragment.progress);
    }
    return;
  }

  if (fragStart) fragStart.visible = false;
  if (fragEnd) fragEnd.visible = false;
  if (mesh) {
    mesh.visible = true;
    const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mat) {
      const opacity = pose.opacity * pose.opacityMul;
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
      mat.color.set(pose.color);
    }
  }
}

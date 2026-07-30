import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyObjectPose, buildNameMap } from './applyPose';
import type { Pose } from '../animation/pose';
import type { SceneObject } from '../state/types';

function obj(partial: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'o',
    name: 'o',
    type: 'mesh',
    parentId: null,
    assetId: 'a',
    visible: true,
    lifetime: { startMs: 0, endMs: 4000 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { color: '#ffffff', opacity: 1, metalness: 0, roughness: 1 },
    ...partial,
  };
}

function pose(partial: Partial<Pose> = {}): Pose {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    opacity: 1,
    opacityMul: 1,
    visible: true,
    color: '#ff0000',
    fragment: null,
    ...partial,
  };
}

/** A fragment mesh whose material exposes the uProgress uniform the driver writes. */
function fragMesh(name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.name = name;
  mesh.material.userData.uProgress = { value: 1 };
  mesh.visible = false;
  return mesh;
}

/** A scene graph shaped like what SceneObjects mounts for a fragmentable object. */
function graph(id: string, extra: THREE.Object3D[] = []) {
  const group = new THREE.Object3D();
  group.name = id;
  const solid = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  solid.name = `${id}__mesh`;
  const start = fragMesh(`${id}__fragStart`);
  const end = fragMesh(`${id}__fragEnd`);
  group.add(solid, start, end, ...extra);
  const root = new THREE.Object3D();
  root.add(group);
  return { root, group, solid, start, end };
}

const uProgressOf = (m: THREE.Mesh) =>
  ((m.material as THREE.Material).userData.uProgress as { value: number }).value;

describe('applyObjectPose fragment handling', () => {
  it('shows the start chunks and hides the solid mesh', () => {
    const g = graph('m1');
    applyObjectPose(
      buildNameMap(g.root),
      obj({ id: 'm1' }),
      pose({ fragment: { which: 'start', progress: 0.5 } }),
    );
    expect(g.solid.visible).toBe(false);
    expect(g.start.visible).toBe(true);
    expect(g.end.visible).toBe(false);
    expect(uProgressOf(g.start)).toBe(0.5);
  });

  it('drives the end chunks for an end transition', () => {
    const g = graph('m1');
    applyObjectPose(
      buildNameMap(g.root),
      obj({ id: 'm1' }),
      pose({ fragment: { which: 'end', progress: 0.25 } }),
    );
    expect(g.end.visible).toBe(true);
    expect(g.start.visible).toBe(false);
    expect(uProgressOf(g.end)).toBe(0.25);
  });

  it('restores the solid mesh once the transition ends', () => {
    const g = graph('m1');
    const nameMap = buildNameMap(g.root);
    applyObjectPose(nameMap, obj({ id: 'm1' }), pose({ fragment: { which: 'start', progress: 0.5 } }));
    applyObjectPose(nameMap, obj({ id: 'm1' }), pose());
    expect(g.solid.visible).toBe(true);
    expect(g.start.visible).toBe(false);
    expect(g.end.visible).toBe(false);
    expect((g.solid.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  });

  it('fragments a glyph, which carries no assetId', () => {
    const g = graph('g1');
    const glyph = obj({
      id: 'g1',
      type: 'glyph',
      assetId: null,
      glyph: { char: 'A', index: 0, layoutPos: [0, 0, 0] },
    });
    const nameMap = buildNameMap(g.root);
    applyObjectPose(nameMap, glyph, pose({ fragment: { which: 'start', progress: 0.75 } }));
    expect(g.solid.visible).toBe(false);
    expect(g.start.visible).toBe(true);
    expect(uProgressOf(g.start)).toBe(0.75);

    applyObjectPose(nameMap, glyph, pose());
    expect(g.solid.visible).toBe(true);
  });

  it('hides a surface’s troika text along with its polygon body', () => {
    const text = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    text.name = 's1__text';
    const g = graph('s1', [text]);
    const surface = obj({
      id: 's1',
      type: 'surface',
      assetId: null,
      surface: { points: [[-1, -1], [1, -1], [0, 1]], content: 'image' },
    });
    const nameMap = buildNameMap(g.root);
    applyObjectPose(nameMap, surface, pose({ fragment: { which: 'start', progress: 0.5 } }));
    expect(g.solid.visible).toBe(false);
    expect(text.visible).toBe(false);
    expect(g.start.visible).toBe(true);

    applyObjectPose(nameMap, surface, pose());
    expect(g.solid.visible).toBe(true);
    expect(text.visible).toBe(true);
  });

  it('falls back to the solid mesh when no chunks are mounted', () => {
    // A text surface can carry a form transition in a loaded document but mounts
    // no fragment meshes; it must keep rendering rather than disappear.
    const group = new THREE.Object3D();
    group.name = 's2';
    const solid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    solid.name = 's2__mesh';
    group.add(solid);
    const root = new THREE.Object3D();
    root.add(group);
    applyObjectPose(
      buildNameMap(root),
      obj({ id: 's2', type: 'surface', assetId: null }),
      pose({ fragment: { which: 'start', progress: 0.5 } }),
    );
    expect(solid.visible).toBe(true);
  });
});

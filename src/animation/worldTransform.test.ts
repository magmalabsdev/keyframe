import { describe, it, expect } from 'vitest';
import { localFromWorldTransform, worldTransformOf } from './worldTransform';
import { createDefaultScene } from '../state/defaults';
import type { Scene, SceneObject } from '../state/types';

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
    material: { color: '#fff', opacity: 1, metalness: 0, roughness: 1 },
    ...partial,
  };
}

function sceneWith(objects: SceneObject[]): Scene {
  const scene = createDefaultScene();
  scene.objects = objects;
  return scene;
}

describe('worldTransformOf', () => {
  it('equals the local transform for a top-level object', () => {
    const parent = obj({
      id: 'p',
      transform: { position: [10, 20, 30], rotation: [0, 45, 0], scale: [2, 1, 1] },
    });
    const scene = sceneWith([parent]);
    const w = worldTransformOf(scene, 'p', 0);
    expect(w.position[0]).toBeCloseTo(10);
    expect(w.position[1]).toBeCloseTo(20);
    expect(w.position[2]).toBeCloseTo(30);
    expect(w.rotation[1]).toBeCloseTo(45);
    expect(w.scale[0]).toBeCloseTo(2);
  });

  it('composes a translated, rotated parent with a child offset', () => {
    // Parent sits at x=100, rotated 90° about Z. A child offset +10 along its
    // own local X should land at world (100, 10, 0): rotating +X by 90° about
    // Z gives +Y, then translate by the parent's position.
    const parent = obj({
      id: 'p',
      transform: { position: [100, 0, 0], rotation: [0, 0, 90], scale: [1, 1, 1] },
    });
    const child = obj({
      id: 'c',
      parentId: 'p',
      transform: { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    const scene = sceneWith([parent, child]);
    const w = worldTransformOf(scene, 'c', 0);
    expect(w.position[0]).toBeCloseTo(100, 5);
    expect(w.position[1]).toBeCloseTo(10, 5);
    expect(w.position[2]).toBeCloseTo(0, 5);
    // The child's world orientation inherits the parent's 90° Z rotation.
    expect(w.rotation[2]).toBeCloseTo(90, 5);
  });

  it('evaluates keyframed ancestor motion at the given time', () => {
    const parent = obj({
      id: 'p',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      tracks: {
        'position.0': [
          { id: 'k0', timeMs: 0, value: 0, interpolation: 'linear' },
          { id: 'k1', timeMs: 1000, value: 100, interpolation: 'linear' },
        ],
      },
    });
    const child = obj({ id: 'c', parentId: 'p' });
    const scene = sceneWith([parent, child]);
    expect(worldTransformOf(scene, 'c', 0).position[0]).toBeCloseTo(0);
    expect(worldTransformOf(scene, 'c', 500).position[0]).toBeCloseTo(50);
    expect(worldTransformOf(scene, 'c', 1000).position[0]).toBeCloseTo(100);
  });
});

describe('localFromWorldTransform', () => {
  it('round-trips worldTransformOf back to the original local values', () => {
    const parent = obj({
      id: 'p',
      transform: { position: [50, -20, 5], rotation: [10, 45, -30], scale: [1.5, 1, 1] },
    });
    const child = obj({
      id: 'c',
      parentId: 'p',
      transform: { position: [10, 5, -3], rotation: [0, 90, 0], scale: [1, 1, 1] },
    });
    const scene = sceneWith([parent, child]);
    const world = worldTransformOf(scene, 'c', 0);
    const local = localFromWorldTransform(scene, 'c', 0, world);
    expect(local.position[0]).toBeCloseTo(child.transform.position[0], 4);
    expect(local.position[1]).toBeCloseTo(child.transform.position[1], 4);
    expect(local.position[2]).toBeCloseTo(child.transform.position[2], 4);
    expect(local.rotation[1]).toBeCloseTo(child.transform.rotation[1], 4);
  });

  it('editing only world rotation leaves the resulting local position unchanged', () => {
    const parent = obj({
      id: 'p',
      transform: { position: [50, -20, 5], rotation: [10, 45, -30], scale: [1, 1, 1] },
    });
    const child = obj({
      id: 'c',
      parentId: 'p',
      transform: { position: [10, 5, -3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    const scene = sceneWith([parent, child]);
    const world = worldTransformOf(scene, 'c', 0);

    const rotatedWorld = { ...world, rotation: [0, 90, 0] as [number, number, number] };
    const local = localFromWorldTransform(scene, 'c', 0, rotatedWorld);

    expect(local.position[0]).toBeCloseTo(child.transform.position[0], 4);
    expect(local.position[1]).toBeCloseTo(child.transform.position[1], 4);
    expect(local.position[2]).toBeCloseTo(child.transform.position[2], 4);
    // The rotation actually did change.
    expect(local.rotation[1]).not.toBeCloseTo(child.transform.rotation[1], 1);
  });

  it('editing only world position leaves the resulting local rotation unchanged', () => {
    const parent = obj({
      id: 'p',
      transform: { position: [50, -20, 5], rotation: [10, 45, -30], scale: [1, 1, 1] },
    });
    const child = obj({
      id: 'c',
      parentId: 'p',
      transform: { position: [10, 5, -3], rotation: [15, 20, 25], scale: [1, 1, 1] },
    });
    const scene = sceneWith([parent, child]);
    const world = worldTransformOf(scene, 'c', 0);

    const movedWorld = { ...world, position: [200, 0, 0] as [number, number, number] };
    const local = localFromWorldTransform(scene, 'c', 0, movedWorld);

    expect(local.rotation[0]).toBeCloseTo(child.transform.rotation[0], 3);
    expect(local.rotation[1]).toBeCloseTo(child.transform.rotation[1], 3);
    expect(local.rotation[2]).toBeCloseTo(child.transform.rotation[2], 3);
    // The position actually did change.
    expect(local.position[0]).not.toBeCloseTo(child.transform.position[0], 1);
  });

  it('is a no-op for a top-level object (parent world is identity)', () => {
    const parent = obj({
      id: 'p',
      transform: { position: [1, 2, 3], rotation: [0, 30, 0], scale: [1, 1, 1] },
    });
    const scene = sceneWith([parent]);
    const world = worldTransformOf(scene, 'p', 0);
    const local = localFromWorldTransform(scene, 'p', 0, world);
    expect(local.position[0]).toBeCloseTo(1);
    expect(local.position[1]).toBeCloseTo(2);
    expect(local.position[2]).toBeCloseTo(3);
    expect(local.rotation[1]).toBeCloseTo(30);
  });
});

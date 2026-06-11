import { describe, it, expect } from 'vitest';
import { serializeProject, parseProjectContainer } from './serialize';
import { createDefaultProject, defaultMaterial, identityTransform } from '../state/defaults';
import type { Asset, Project, SceneObject } from '../state/types';

function makeProject(): Project {
  const project = createDefaultProject();
  const asset: Asset = {
    id: 'asset1',
    name: 'cube',
    format: 'stl',
    geometry: {
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      index: [0, 1, 2],
    },
  };
  const obj: SceneObject = {
    id: 'obj1',
    name: 'cube',
    type: 'mesh',
    parentId: null,
    assetId: 'asset1',
    visible: true,
    lifetime: { startMs: 0, endMs: 5000 },
    transform: identityTransform(),
    keyframes: [
      {
        id: 'k0',
        timeMs: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        interpolation: 'linear',
      },
      {
        id: 'k1',
        timeMs: 2000,
        position: [100, 0, 50],
        rotation: [0, 0, 45],
        scale: [1, 1, 1],
        interpolation: 'easeInOut',
      },
    ],
    centerOfRotation: [0, 0, 0],
    material: defaultMaterial(),
  };
  project.assets[asset.id] = asset;
  project.scenes[0].objects.push(obj);
  project.name = 'Test Project';
  return project;
}

describe('serializeProject / parseProjectContainer', () => {
  it('round-trips a project with geometry and keyframes', () => {
    const project = makeProject();
    const bytes = serializeProject(project, [project.scenes[0].id]);
    const { project: out, geometries } = parseProjectContainer(bytes);

    expect(out.name).toBe('Test Project');
    expect(out.scenes).toHaveLength(1);
    expect(out.scenes[0].objects[0].keyframes).toHaveLength(2);
    expect(out.scenes[0].objects[0].keyframes[1].interpolation).toBe('easeInOut');

    const asset = out.assets['asset1'];
    expect(asset.geometry.positions).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(asset.geometry.index).toEqual([0, 1, 2]);
    expect(geometries.get('asset1')).toBeDefined();
  });

  it('only includes assets referenced by exported scenes', () => {
    const project = makeProject();
    project.assets['orphan'] = {
      id: 'orphan',
      name: 'unused',
      format: 'stl',
      geometry: { positions: [0, 0, 0] },
    };
    const bytes = serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);
    expect(Object.keys(out.assets)).toEqual(['asset1']);
  });
});

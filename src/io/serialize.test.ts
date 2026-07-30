import { describe, it, expect } from 'vitest';
import { serializeProject, parseProjectContainer } from './serialize';
import { getGeometryData, putGeometryData } from './geometryCache';
import { createDefaultProject, defaultMaterial, identityTransform } from '../state/defaults';
import type { Asset, Project, SceneObject } from '../state/types';

function makeProject(): Project {
  const project = createDefaultProject();
  const asset: Asset = { id: 'asset1', name: 'cube', format: 'stl' };
  // Geometry lives in the cache (not in the project doc).
  putGeometryData('asset1', {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: Uint32Array.from([0, 1, 2]),
  });
  const obj: SceneObject = {
    id: 'obj1',
    name: 'cube',
    type: 'mesh',
    parentId: null,
    assetId: 'asset1',
    visible: true,
    lifetime: { startMs: 0, endMs: 5000 },
    transform: identityTransform(),
    tracks: {},
    // Legacy whole-pose keyframes; parseProjectContainer migrates them to tracks.
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
  it('round-trips a project and migrates legacy keyframes to per-channel tracks', async () => {
    const project = makeProject();
    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out, geometries } = parseProjectContainer(bytes);

    expect(out.name).toBe('Test Project');
    expect(out.scenes).toHaveLength(1);
    const outObj = out.scenes[0].objects[0];
    expect(outObj.keyframes).toBeUndefined(); // migrated away
    expect(outObj.tracks['position.0']).toHaveLength(2);
    expect(outObj.tracks['position.0']![1].value).toBe(100);
    expect(outObj.tracks['rotation.2']![1].value).toBe(45);
    expect(outObj.tracks['rotation.2']![1].interpolation).toBe('easeInOut');

    // Asset metadata only in the project; geometry round-trips via the cache.
    expect(out.assets['asset1']).toBeDefined();
    const data = getGeometryData('asset1');
    expect(Array.from(data!.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(Array.from(data!.index!)).toEqual([0, 1, 2]);
    expect(geometries.get('asset1')).toBeDefined();
  });

  it('only includes assets referenced by exported scenes', async () => {
    const project = makeProject();
    project.assets['orphan'] = { id: 'orphan', name: 'unused', format: 'stl' };
    putGeometryData('orphan', { positions: Float32Array.from([0, 0, 0]) });
    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);
    expect(Object.keys(out.assets)).toEqual(['asset1']);
  });
});

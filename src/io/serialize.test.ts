import { describe, it, expect } from 'vitest';
import { serializeProject, parseProjectContainer } from './serialize';
import { getGeometryData, putGeometryData } from './geometryCache';
import { putMedia } from './mediaCache';
import {
  createDefaultProject,
  createDefaultScene,
  createGlyphObject,
  createLightObject,
  createSurfaceObject,
  createTextObject,
  defaultMaterial,
  identityTransform,
} from '../state/defaults';
import { DOCUMENT_VERSION, type Asset, type Project, type SceneObject } from '../state/types';

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
    const outObj = out.scenes[0].objects.find((o) => o.id === 'obj1')!;
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

  it('round-trips the scene ambient fill light', async () => {
    const project = makeProject();
    project.scenes[0].settings.ambientIntensity = 0;
    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);
    // Must survive migration's presence-based backfill, not be reset to default.
    expect(out.scenes[0].settings.ambientIntensity).toBe(0);
  });

  it('only includes assets referenced by exported scenes', async () => {
    const project = makeProject();
    project.assets['orphan'] = { id: 'orphan', name: 'unused', format: 'stl' };
    putGeometryData('orphan', { positions: Float32Array.from([0, 0, 0]) });
    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);
    expect(Object.keys(out.assets)).toEqual(['asset1']);
  });

  it('round-trips light objects and emitter light params/tracks', async () => {
    const project = makeProject();
    const light = createLightObject(5000, 'Key light');
    light.tracks['light.intensity'] = [
      { id: 'ki0', timeMs: 0, value: 0, interpolation: 'linear' },
      { id: 'ki1', timeMs: 2000, value: 6, interpolation: 'easeOut' },
    ];
    project.scenes[0].objects.push(light);
    const emitter = project.scenes[0].objects.find((o) => o.id === 'obj1')!;
    emitter.light = {
      enabled: true,
      color: '#ff8800',
      intensity: 2,
      spreadDeg: 200,
      softness: 0.1,
      direction: [1, 0, 0],
    };

    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);

    expect(out.version).toBe(DOCUMENT_VERSION);
    const outLight = out.scenes[0].objects.find((o) => o.id === light.id)!;
    expect(outLight.type).toBe('light');
    expect(outLight.assetId).toBeNull();
    expect(outLight.light).toEqual(light.light);
    expect(outLight.tracks['light.intensity']).toHaveLength(2);
    expect(outLight.tracks['light.intensity']![1].value).toBe(6);
    const outEmitter = out.scenes[0].objects.find((o) => o.id === 'obj1')!;
    expect(outEmitter.light).toEqual(emitter.light);
    // Migration must not inject an extra light into an already-lit v3 scene.
    expect(out.scenes[0].objects.filter((o) => o.type === 'light')).toHaveLength(
      project.scenes[0].objects.filter((o) => o.type === 'light').length,
    );
  });

  it('round-trips a surface object and embeds the media it references', async () => {
    const project = makeProject();
    // Media blobs live in the runtime cache, keyed by the id the doc records.
    putMedia('media1', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    project.media['media1'] = {
      id: 'media1',
      name: 'label.png',
      mimeType: 'image/png',
      kind: 'image',
    };
    const surface = createSurfaceObject(5000, {
      name: 'Label',
      parentId: 'obj1',
      surface: {
        content: 'text',
        mediaId: 'media1',
        text: 'Hello\nworld',
        fontSize: 24,
        align: 'left',
        points: [
          [-50, -20],
          [50, -20],
          [50, 20],
          [-50, 20],
        ],
      },
    });
    project.scenes[0].objects.push(surface);

    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);

    // The used-media scan must see surface.mediaId, or the asset silently
    // vanishes and the surface reopens blank.
    expect(out.media['media1']).toBeDefined();
    expect(out.media['media1'].name).toBe('label.png');

    const outSurface = out.scenes[0].objects.find((o) => o.id === surface.id)!;
    expect(outSurface.type).toBe('surface');
    expect(outSurface.assetId).toBeNull();
    expect(outSurface.parentId).toBe('obj1');
    expect(outSurface.surface).toEqual(surface.surface);
  });

  it('round-trips audio tracks and embeds the audio media they reference', async () => {
    const project = makeProject();
    putMedia('song1', new Blob([new Uint8Array([5, 6, 7, 8])], { type: 'audio/mpeg' }));
    project.media['song1'] = {
      id: 'song1',
      name: 'theme.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
    };
    project.scenes[0].audioTracks = [
      {
        id: 'trk1',
        name: 'Music',
        muted: false,
        gain: 0.8,
        clips: [
          {
            id: 'clip1',
            name: 'theme',
            mediaId: 'song1',
            startMs: 250,
            offsetMs: 100,
            durationMs: 4000,
            sourceDurationMs: 6000,
            gain: 1,
            loop: true,
          },
        ],
      },
    ];

    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);

    // The used-media scan must include clip.mediaId, or the blob is dropped.
    expect(out.media['song1']).toBeDefined();
    expect(out.media['song1'].kind).toBe('audio');
    const outTracks = out.scenes[0].audioTracks;
    expect(outTracks).toHaveLength(1);
    expect(outTracks[0].gain).toBe(0.8);
    expect(outTracks[0].clips[0]).toEqual(project.scenes[0].audioTracks[0].clips[0]);
  });

  it('round-trips a 3D text subtree and embeds the fonts it references', async () => {
    const project = makeProject();
    putMedia('font1', new Blob([new Uint8Array([10, 11])], { type: 'font/ttf' }));
    project.media['font1'] = {
      id: 'font1',
      name: 'Comic Sans MS',
      mimeType: 'font/ttf',
      kind: 'font',
    };
    putMedia('font2', new Blob([new Uint8Array([12])], { type: 'font/woff' }));
    project.media['font2'] = {
      id: 'font2',
      name: 'Surface Font',
      mimeType: 'font/woff',
      kind: 'font',
    };
    const textObj = createTextObject(5000, {
      text: { text: 'Hi', fontId: 'font1', depth: 25, writeOn: 0.5 },
    });
    textObj.tracks['text.writeOn'] = [
      { id: 'w0', timeMs: 0, value: 0, interpolation: 'linear' },
      { id: 'w1', timeMs: 2000, value: 1, interpolation: 'easeOut' },
    ];
    const glyph = createGlyphObject(textObj, 'H', 0, [-10, 0, -12.5]);
    const surface = createSurfaceObject(5000, {
      surface: { content: 'text', text: 'Flat', fontId: 'font2', writeOn: 0.25 },
    });
    project.scenes[0].objects.push(textObj, glyph, surface);

    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);

    // The used-media scan must see text.fontId and surface.fontId, or the
    // embedded fonts silently vanish from the exported file.
    expect(out.media['font1']).toBeDefined();
    expect(out.media['font1'].kind).toBe('font');
    expect(out.media['font2']).toBeDefined();

    const outText = out.scenes[0].objects.find((o) => o.id === textObj.id)!;
    expect(outText.type).toBe('text');
    expect(outText.text).toEqual(textObj.text);
    expect(outText.tracks['text.writeOn']).toHaveLength(2);
    const outGlyph = out.scenes[0].objects.find((o) => o.id === glyph.id)!;
    expect(outGlyph.type).toBe('glyph');
    expect(outGlyph.parentId).toBe(textObj.id);
    expect(outGlyph.glyph).toEqual(glyph.glyph);
    const outSurface = out.scenes[0].objects.find((o) => o.id === surface.id)!;
    expect(outSurface.surface?.fontId).toBe('font2');
    expect(outSurface.surface?.writeOn).toBe(0.25);
  });

  it('omits fonts not referenced by any exported object', async () => {
    const project = makeProject();
    putMedia('unusedFont', new Blob([new Uint8Array([1])], { type: 'font/ttf' }));
    project.media['unusedFont'] = {
      id: 'unusedFont',
      name: 'Unused',
      mimeType: 'font/ttf',
      kind: 'font',
    };
    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);
    expect(out.media['unusedFont']).toBeUndefined();
  });

  it('omits media referenced only by a scene that is not exported', async () => {
    const project = makeProject();
    putMedia('lonely', new Blob([new Uint8Array([9])], { type: 'image/png' }));
    project.media['lonely'] = {
      id: 'lonely',
      name: 'other.png',
      mimeType: 'image/png',
      kind: 'image',
    };
    const other = createDefaultScene('Scene 2');
    other.objects.push(
      createSurfaceObject(5000, { surface: { mediaId: 'lonely' } }),
    );
    project.scenes.push(other);

    const bytes = await serializeProject(project, [project.scenes[0].id]);
    const { project: out } = parseProjectContainer(bytes);
    expect(out.media['lonely']).toBeUndefined();
  });
});

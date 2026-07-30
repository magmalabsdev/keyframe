import { describe, it, expect } from 'vitest';
import { migrateProject } from './migrate';
import { DOCUMENT_VERSION, type Point2, type Project, type SceneObject } from './types';
import {
  DEFAULT_AMBIENT_INTENSITY,
  DEFAULT_FPS,
  defaultLightParams,
  defaultMaterial,
  defaultSurfaceParams,
  defaultTextParams,
  identityTransform,
} from './defaults';

function mesh(id: string, partial: Partial<SceneObject> = {}): SceneObject {
  return {
    id,
    name: id,
    type: 'mesh',
    parentId: null,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: 5000 },
    transform: identityTransform(),
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: defaultMaterial(),
    ...partial,
  };
}

/** A hand-built v2 project (pre scene-lighting): no light objects anywhere. */
function v2Project(): Project {
  return {
    version: 2,
    name: 'old',
    scenes: [
      {
        id: 's1',
        name: 'Scene 1',
        durationMs: 5000,
        settings: {
          backgroundColor: '#15171c',
          gridSize: 100,
          buildPlateWidth: 1600,
          buildPlateDepth: 900,
          lengthUnit: 'mm',
          angleUnit: 'deg',
        },
        camera: {
          default: { position: [0, 0, 1200], target: [0, 0, 0] },
          tracks: {},
        },
        objects: [mesh('m1')],
        audioTracks: [],
      },
    ],
    activeSceneId: 's1',
    assets: {},
    media: {},
    variables: [],
    bindings: {},
  };
}

describe('migrateProject (v2 -> v3 light injection)', () => {
  it('injects one default light per unlit scene and stamps the version', () => {
    const p = migrateProject(v2Project());
    expect(p.version).toBe(DOCUMENT_VERSION);
    const lights = p.scenes[0].objects.filter((o) => o.type === 'light');
    expect(lights).toHaveLength(1);
    expect(lights[0].light).toEqual(defaultLightParams());
    expect(lights[0].lifetime).toEqual({ startMs: 0, endMs: 5000 });
  });

  it('is idempotent: a second migration injects nothing', () => {
    const p = migrateProject(migrateProject(v2Project()));
    expect(p.scenes[0].objects.filter((o) => o.type === 'light')).toHaveLength(1);
  });

  it('does not resurrect a deleted light in a current-version project', () => {
    const p = migrateProject(v2Project());
    p.scenes[0].objects = p.scenes[0].objects.filter((o) => o.type !== 'light');
    const again = migrateProject(p);
    expect(again.scenes[0].objects.some((o) => o.type === 'light')).toBe(false);
  });

  it('skips scenes that already have an enabled emitter mesh', () => {
    const p = v2Project();
    p.scenes[0].objects.push(mesh('glow', { light: defaultLightParams() }));
    const out = migrateProject(p);
    expect(out.scenes[0].objects.some((o) => o.type === 'light')).toBe(false);
  });

  it('still converts legacy whole-pose keyframes into tracks', () => {
    const p = v2Project();
    p.scenes[0].objects[0].keyframes = [
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
        position: [100, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        interpolation: 'linear',
      },
    ];
    const out = migrateProject(p);
    const m = out.scenes[0].objects.find((o) => o.id === 'm1')!;
    expect(m.keyframes).toBeUndefined();
    expect(m.tracks['position.0']).toHaveLength(2);
    expect(m.tracks['position.0']![1].value).toBe(100);
  });

  it('converts legacy whole-pose camera keyframes into per-axis tracks', () => {
    const p = v2Project();
    (p.scenes[0].camera as { keyframes?: unknown }).keyframes = [
      { id: 'c0', timeMs: 0, position: [0, 0, 1200], target: [0, 0, 0], interpolation: 'linear' },
      { id: 'c1', timeMs: 2000, position: [500, 0, 1200], target: [0, 0, 50], interpolation: 'linear' },
    ];
    const out = migrateProject(p);
    const cam = out.scenes[0].camera;
    expect(cam.keyframes).toBeUndefined();
    expect(cam.tracks['position.0']).toHaveLength(2);
    expect(cam.tracks['position.0']![1].value).toBe(500);
    expect(cam.tracks['target.2']).toHaveLength(2);
    expect(cam.tracks['target.2']![1].value).toBe(50);
  });
});

describe('migrateProject (v4 -> v5 audio tracks)', () => {
  it('backfills an empty audioTracks array on scenes that lack one', () => {
    const p = v2Project();
    // Simulate a pre-v5 file where the field did not exist yet.
    for (const s of p.scenes) delete (s as { audioTracks?: unknown }).audioTracks;
    const out = migrateProject(p);
    expect(out.version).toBe(DOCUMENT_VERSION);
    expect(out.scenes[0].audioTracks).toEqual([]);
  });

  it('preserves existing audio tracks and clips', () => {
    const p = v2Project();
    p.scenes[0].audioTracks = [
      {
        id: 't1',
        name: 'Music',
        muted: false,
        gain: 1,
        clips: [
          {
            id: 'c1',
            name: 'song',
            mediaId: 'media-1',
            startMs: 500,
            offsetMs: 0,
            durationMs: 3000,
            sourceDurationMs: 3000,
            gain: 1,
            loop: false,
          },
        ],
      },
    ];
    const out = migrateProject(p);
    expect(out.scenes[0].audioTracks).toHaveLength(1);
    expect(out.scenes[0].audioTracks[0].clips[0].mediaId).toBe('media-1');
  });
});

describe('migrateProject (surface backfill)', () => {
  it('fills in surface params that a file omitted entirely', () => {
    const p = v2Project();
    p.scenes[0].objects.push(mesh('s1', { type: 'surface' }));
    const out = migrateProject(p);
    const surface = out.scenes[0].objects.find((o) => o.id === 's1')!;
    expect(surface.surface).toEqual(defaultSurfaceParams());
  });

  it('repairs a degenerate polygon that could not be triangulated', () => {
    const p = v2Project();
    p.scenes[0].objects.push(
      mesh('s1', {
        type: 'surface',
        surface: { ...defaultSurfaceParams(), points: [[0, 0]] },
      }),
    );
    const out = migrateProject(p);
    const surface = out.scenes[0].objects.find((o) => o.id === 's1')!;
    expect(surface.surface!.points).toEqual(defaultSurfaceParams().points);
  });

  it('preserves surface params that are already valid', () => {
    const points: Point2[] = [
      [-10, -10],
      [10, -10],
      [0, 10],
    ];
    const p = v2Project();
    p.scenes[0].objects.push(
      mesh('s1', {
        type: 'surface',
        surface: { ...defaultSurfaceParams(), content: 'text', text: 'hi', points },
      }),
    );
    const out = migrateProject(p);
    const surface = out.scenes[0].objects.find((o) => o.id === 's1')!.surface!;
    expect(surface.points).toEqual(points);
    expect(surface.text).toBe('hi');
    expect(surface.content).toBe('text');
  });

  it('backfills the ambient fill light without bumping the version', () => {
    const p = v2Project();
    const out = migrateProject(p);
    expect(out.scenes[0].settings.ambientIntensity).toBe(DEFAULT_AMBIENT_INTENSITY);
    expect(out.version).toBe(DOCUMENT_VERSION);
  });

  it('preserves an ambient intensity deliberately dialed to zero', () => {
    const p = v2Project();
    p.scenes[0].settings.ambientIntensity = 0;
    expect(migrateProject(p).scenes[0].settings.ambientIntensity).toBe(0);
  });

  it('backfills the frame rate and an empty marker list', () => {
    const out = migrateProject(v2Project());
    expect(out.scenes[0].settings.fps).toBe(DEFAULT_FPS);
    expect(out.scenes[0].markers).toEqual([]);
    // Both are additive optional fields, so the version does not move.
    expect(out.version).toBe(DOCUMENT_VERSION);
  });

  it('preserves an existing frame rate and existing markers', () => {
    const p = v2Project();
    p.scenes[0].settings.fps = 24;
    p.scenes[0].markers = [{ id: 'm1', timeMs: 500, name: 'Cue', color: '#fff' }];
    const out = migrateProject(p);
    expect(out.scenes[0].settings.fps).toBe(24);
    expect(out.scenes[0].markers).toHaveLength(1);
    expect(out.scenes[0].markers![0].name).toBe('Cue');
  });

  it('backfills text params on text objects and clamps write-on values', () => {
    const p = v2Project();
    p.scenes[0].objects.push(
      mesh('t1', { type: 'text', text: { text: 'Hi' } as SceneObject['text'] }),
      mesh('t2', { type: 'text', text: undefined }),
      mesh('t3', {
        type: 'text',
        text: {
          text: 'x',
          fontSize: 40,
          depth: 10,
          align: 'center',
          letterSpacing: 0,
          lineHeight: 1.15,
          writeOn: 7,
        },
      }),
    );
    const out = migrateProject(p);
    const t1 = out.scenes[0].objects.find((o) => o.id === 't1')!.text!;
    expect(t1.text).toBe('Hi');
    expect(t1.fontSize).toBe(40);
    expect(t1.depth).toBe(10);
    const t2 = out.scenes[0].objects.find((o) => o.id === 't2')!.text!;
    expect(t2).toEqual(defaultTextParams());
    expect(out.scenes[0].objects.find((o) => o.id === 't3')!.text!.writeOn).toBe(1);
  });

  it('backfills glyph params and clamps surface write-on', () => {
    const p = v2Project();
    p.scenes[0].objects.push(
      mesh('g1', { type: 'glyph', parentId: 't1', glyph: undefined }),
      mesh('s1', {
        type: 'surface',
        surface: { ...defaultSurfaceParams(), writeOn: -2 },
      }),
    );
    const out = migrateProject(p);
    const g1 = out.scenes[0].objects.find((o) => o.id === 'g1')!;
    expect(g1.glyph).toEqual({ char: '?', index: 0, layoutPos: [0, 0, 0] });
    expect(out.scenes[0].objects.find((o) => o.id === 's1')!.surface!.writeOn).toBe(0);
  });

  it('is idempotent over a project containing surfaces', () => {
    const p = v2Project();
    p.scenes[0].objects.push(mesh('s1', { type: 'surface' }));
    const once = structuredClone(migrateProject(structuredClone(p)));
    const twice = structuredClone(migrateProject(migrateProject(structuredClone(p))));
    // Injected lights get fresh nanoids, so compare everything else.
    const strip = (proj: Project) => ({
      ...proj,
      scenes: proj.scenes.map((s) => ({
        ...s,
        objects: s.objects.filter((o) => o.type !== 'light'),
      })),
    });
    expect(strip(twice)).toEqual(strip(once));
  });
});

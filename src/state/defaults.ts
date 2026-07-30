import { nanoid } from 'nanoid';
import {
  DOCUMENT_VERSION,
  type AudioTrack,
  type LightParams,
  type Material,
  type Point2,
  type Project,
  type Scene,
  type SceneObject,
  type SurfaceParams,
  type TextParams,
  type Transform,
  type Vec3,
} from './types';

/** Default framing rectangle from the spec: camera covers 1600mm x 900mm (16:9). */
export const DEFAULT_PLATE_WIDTH = 1600;
export const DEFAULT_PLATE_DEPTH = 900;

/**
 * Default fill light: ~10% of the default scene light's intensity (3). Enough
 * that a face turned away from every light reads as a dark version of its own
 * color instead of pure black, without flattening the lighting.
 */
export const DEFAULT_AMBIENT_INTENSITY = 0.3;

/** Default timeline frame rate (also the video export default). */
export const DEFAULT_FPS = 30;

export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

export const defaultMaterial = (): Material => ({
  color: '#b8c0cc',
  opacity: 1,
  metalness: 0.1,
  roughness: 0.6,
});

/** Wide, soft, white overhead light. Intensity is candela with no distance
 *  falloff (decay 0) — decay 2 in a mm-scale world would need ~1e5 candela. */
export const defaultLightParams = (): LightParams => ({
  enabled: true,
  color: '#ffffff',
  intensity: 3,
  spreadDeg: 130,
  softness: 0.35,
  direction: [0, 0, -1],
});

/**
 * A scene light object: 800mm above the plate pointing down, spread wide
 * enough (130° from 800mm ≈ 1716mm radius) to cover the 1600x900 plate.
 */
export function createLightObject(durationMs: number, name = 'Light'): SceneObject {
  return {
    id: nanoid(),
    name,
    type: 'light',
    parentId: null,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: durationMs },
    transform: { ...identityTransform(), position: [0, 0, 800] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: defaultMaterial(),
    light: defaultLightParams(),
  };
}

export const DEFAULT_SURFACE_W = 200;
export const DEFAULT_SURFACE_H = 120;

/** Counter-clockwise rectangle centered on the local origin. */
export function rectPoints(width: number, height: number): Point2[] {
  const hw = width / 2;
  const hh = height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
}

export const defaultSurfaceParams = (): SurfaceParams => ({
  points: rectPoints(DEFAULT_SURFACE_W, DEFAULT_SURFACE_H),
  content: 'image',
  fit: 'stretch',
  doubleSided: true,
  showBackground: true,
  backgroundColor: '#000000',
  text: 'Text',
  fontSize: 40,
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.15,
});

/**
 * A flat polygonal surface. Standalone ones sit 100mm above the plate so they
 * don't z-fight the grid; the on-surface tool passes its own transform/parent.
 */
export function createSurfaceObject(
  durationMs: number,
  opts: {
    name?: string;
    parentId?: string | null;
    transform?: Transform;
    surface?: Partial<SurfaceParams>;
    /** Fill color — for a text surface, the color of the text itself. */
    color?: string;
  } = {},
): SceneObject {
  return {
    id: nanoid(),
    name: opts.name ?? 'Surface',
    type: 'surface',
    parentId: opts.parentId ?? null,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: durationMs },
    transform: opts.transform ?? { ...identityTransform(), position: [0, 0, 100] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { ...defaultMaterial(), ...(opts.color ? { color: opts.color } : {}) },
    surface: { ...defaultSurfaceParams(), ...opts.surface },
  };
}

export const defaultTextParams = (): TextParams => ({
  text: 'Text',
  fontSize: 40,
  depth: 10,
  align: 'center',
  vAlign: 'center',
  letterSpacing: 0,
  lineHeight: 1.15,
  writeOn: 1,
});

/**
 * An extruded 3D text container. Glyph children are created separately by the
 * reconciler (scene/textLayout.ts); callers pass the result through
 * `reconcileTextChildren` (or use the store's addTextObject) to populate them.
 */
export function createTextObject(
  durationMs: number,
  opts: {
    name?: string;
    parentId?: string | null;
    transform?: Transform;
    text?: Partial<TextParams>;
    /** Default color of the text's glyphs. */
    color?: string;
  } = {},
): SceneObject {
  return {
    id: nanoid(),
    name: opts.name ?? 'Text',
    type: 'text',
    parentId: opts.parentId ?? null,
    assetId: null,
    visible: true,
    lifetime: { startMs: 0, endMs: durationMs },
    transform: opts.transform ?? { ...identityTransform(), position: [0, 0, 100] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { ...defaultMaterial(), ...(opts.color ? { color: opts.color } : {}) },
    text: { ...defaultTextParams(), ...opts.text },
  };
}

/** One character of a text object. Inherits the parent's lifetime and material. */
export function createGlyphObject(
  parent: SceneObject,
  char: string,
  index: number,
  layoutPos: Vec3,
): SceneObject {
  return {
    id: nanoid(),
    name: `'${char}'`,
    type: 'glyph',
    parentId: parent.id,
    assetId: null,
    visible: true,
    lifetime: { ...parent.lifetime },
    transform: { ...identityTransform(), position: [...layoutPos] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: { ...parent.material },
    glyph: { char, index, layoutPos: [...layoutPos] },
  };
}

/** A new, empty audio track. */
export function createAudioTrack(name = 'Audio'): AudioTrack {
  return { id: nanoid(), name, muted: false, gain: 1, clips: [] };
}

export function createDefaultScene(name = 'Scene 1'): Scene {
  const durationMs = 5000;
  return {
    id: nanoid(),
    name,
    durationMs,
    settings: {
      backgroundColor: '#15171c',
      ambientIntensity: DEFAULT_AMBIENT_INTENSITY,
      fps: DEFAULT_FPS,
      gridSize: 100,
      buildPlateWidth: DEFAULT_PLATE_WIDTH,
      buildPlateDepth: DEFAULT_PLATE_DEPTH,
      lengthUnit: 'mm',
      angleUnit: 'deg',
    },
    camera: {
      // Looking straight down -Z at the build plate origin (Z-up world).
      default: { position: [0, 0, 1200], target: [0, 0, 0] },
      tracks: {},
    },
    // Scenes start with one deletable default light (there is no other
    // built-in lighting; a scene with no lights renders dark).
    objects: [createLightObject(durationMs)],
    audioTracks: [],
    markers: [],
  };
}

export function createDefaultProject(): Project {
  const scene = createDefaultScene();
  return {
    version: DOCUMENT_VERSION,
    name: 'Untitled Project',
    scenes: [scene],
    activeSceneId: scene.id,
    assets: {},
    media: {},
    variables: [],
    bindings: {},
  };
}

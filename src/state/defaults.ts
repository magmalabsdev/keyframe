import { nanoid } from 'nanoid';
import {
  DOCUMENT_VERSION,
  type Material,
  type Project,
  type Scene,
  type Transform,
} from './types';

/** Default framing rectangle from the spec: camera covers 1600mm x 900mm (16:9). */
export const DEFAULT_PLATE_WIDTH = 1600;
export const DEFAULT_PLATE_DEPTH = 900;

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

export function createDefaultScene(name = 'Scene 1'): Scene {
  return {
    id: nanoid(),
    name,
    durationMs: 5000,
    settings: {
      backgroundColor: '#15171c',
      gridSize: 100,
      buildPlateWidth: DEFAULT_PLATE_WIDTH,
      buildPlateDepth: DEFAULT_PLATE_DEPTH,
      lengthUnit: 'mm',
      angleUnit: 'deg',
    },
    camera: {
      // Looking straight down -Z at the build plate origin (Z-up world).
      default: { position: [0, 0, 1200], target: [0, 0, 0] },
      keyframes: [],
    },
    objects: [],
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

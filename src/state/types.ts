/**
 * Serializable document model for keyframe projects.
 *
 * Conventions:
 *  - Coordinate system is Z-up (build plate on the XY plane, camera looks down -Z).
 *  - Positions are in millimeters, rotations in degrees (Euler XYZ).
 *  - Everything in this file must be JSON-serializable so a Project can be
 *    written to a self-contained .kfp / .kfpx file.
 */

export type Vec3 = [number, number, number];

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';

export type ModelFormat = 'stl' | 'obj' | 'gltf' | 'glb' | 'step';

/** Raw triangle data for a single mesh, stored so files are self-contained. */
export interface GeometryData {
  /** Flat XYZ positions, length = vertexCount * 3. */
  positions: number[];
  /** Optional flat XYZ normals, length = vertexCount * 3. */
  normals?: number[];
  /** Optional triangle index buffer. */
  index?: number[];
}

export interface Asset {
  id: string;
  name: string;
  format: ModelFormat;
  geometry: GeometryData;
}

export interface Material {
  /** Hex color, e.g. "#cccccc". */
  color: string;
  /** 0 (transparent) .. 1 (opaque). */
  opacity: number;
  /** Reflectivity proxy, 0 (matte) .. 1 (mirror). */
  metalness: number;
  /** Surface roughness, 0 (glossy) .. 1 (rough). */
  roughness: number;
}

export interface Transform {
  position: Vec3; // mm
  rotation: Vec3; // degrees, Euler XYZ
  scale: Vec3;
}

export interface Keyframe extends Transform {
  id: string;
  timeMs: number;
  interpolation: Easing;
}

export interface Lifetime {
  startMs: number;
  endMs: number;
}

export interface SceneObject {
  id: string;
  name: string;
  type: 'mesh' | 'group';
  parentId: string | null;
  /** For meshes: the geometry asset this object references. */
  assetId: string | null;
  visible: boolean;
  lifetime: Lifetime;
  /** Base transform used when the object has no keyframes. */
  transform: Transform;
  keyframes: Keyframe[];
  /** Center of rotation, expressed as a local offset from the object origin. */
  centerOfRotation: Vec3;
  material: Material;
}

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

export interface CameraKeyframe extends CameraState {
  id: string;
  timeMs: number;
  interpolation: Easing;
}

export interface SceneSettings {
  backgroundColor: string;
  /** Grid cell size in mm. */
  gridSize: number;
  /** Build plate framing rectangle (mm). */
  buildPlateWidth: number;
  buildPlateDepth: number;
  lengthUnit: 'mm';
  angleUnit: 'deg';
}

export interface Scene {
  id: string;
  name: string;
  durationMs: number;
  settings: SceneSettings;
  camera: {
    default: CameraState;
    keyframes: CameraKeyframe[];
  };
  objects: SceneObject[];
}

export interface Project {
  /** Document schema version, bumped on breaking format changes. */
  version: number;
  name: string;
  scenes: Scene[];
  activeSceneId: string;
  /** Geometry assets keyed by id, shared across scenes. */
  assets: Record<string, Asset>;
}

export const DOCUMENT_VERSION = 1;

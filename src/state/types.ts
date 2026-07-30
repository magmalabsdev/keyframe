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

/**
 * Raw triangle data for a single mesh. Stored as typed arrays (not number[]) so
 * it transfers cheaply across the import worker and structured-clones compactly.
 * This is heavy and is kept OUT of the document store — it lives in
 * io/geometryCache.ts (runtime) and is persisted/exported separately by id.
 */
export interface GeometryData {
  /** Flat XYZ positions, length = vertexCount * 3. */
  positions: Float32Array;
  /** Optional flat XYZ normals, length = vertexCount * 3. */
  normals?: Float32Array;
  /** Optional triangle index buffer. */
  index?: Uint32Array;
}

/**
 * Geometry asset metadata. The actual triangle data is NOT stored here (it would
 * bloat undo snapshots and autosave); it lives in io/geometryCache.ts keyed by `id`.
 */
export interface Asset {
  id: string;
  name: string;
  format: ModelFormat;
}

export type TextureMode = 'fill' | 'tile';

export interface Material {
  /** Hex color, e.g. "#cccccc". */
  color: string;
  /** 0 (transparent) .. 1 (opaque). */
  opacity: number;
  /** Reflectivity proxy, 0 (matte) .. 1 (mirror). */
  metalness: number;
  /** Surface roughness, 0 (glossy) .. 1 (rough). */
  roughness: number;
  /** Media asset id of an image wrapped (box-projected) onto all faces. */
  textureAssetId?: string;
  /** How the texture maps onto box-projected UVs. 'fill' (default) stretches
   *  the image to cover each face; 'tile' repeats it at its native aspect
   *  ratio, sized by textureScale. */
  textureMode?: TextureMode;
  /** Tile size in mm (length of one repetition along the image's wider
   *  axis). Only used when textureMode is 'tile'. Defaults to 100. */
  textureScale?: number;
}

export type MediaKind = 'image' | 'video';

/** Metadata for an uploaded image/gif/video. The actual blob lives in io/mediaCache.ts. */
export interface MediaAsset {
  id: string;
  name: string;
  mimeType: string;
  kind: MediaKind;
}

export interface Transform {
  position: Vec3; // mm
  rotation: Vec3; // degrees, Euler XYZ
  scale: Vec3;
}

/**
 * Per-value animation channel. Each keyframable value (each transform axis,
 * opacity, color, or a variable) owns an independent sorted list of these.
 */
export type ChannelKey =
  | 'position.0'
  | 'position.1'
  | 'position.2'
  | 'rotation.0'
  | 'rotation.1'
  | 'rotation.2'
  | 'scale.0'
  | 'scale.1'
  | 'scale.2'
  | 'opacity'
  | 'color';

/** A single keyframe on one value channel. `value` is hex for the color channel. */
export interface ValueKeyframe {
  id: string;
  timeMs: number;
  value: number | string;
  interpolation: Easing;
}

/** Per-channel keyframe tracks, keyed by channel. Each list is sorted by time. */
export type Tracks = Partial<Record<ChannelKey, ValueKeyframe[]>>;

/** @deprecated Whole-pose keyframe — retained for camera keyframes and migration. */
export interface Keyframe extends Transform {
  id: string;
  timeMs: number;
  interpolation: Easing;
  /** Hex color, e.g. "#cccccc". Optional for back-compat with older files. */
  color?: string;
}

export interface Lifetime {
  startMs: number;
  endMs: number;
}

export type IdleType = 'none' | 'rotate' | 'flicker' | 'pulse' | 'wiggle';
export type TransitionType =
  | 'none'
  | 'pop'
  | 'fade'
  | 'digital'
  | 'flicker'
  | 'voxel form'
  | 'particle form'
  | 'polygon form';

/** True for the "form" transitions that fragment the part into chunks. */
export function isFormTransition(t: TransitionType): boolean {
  return t === 'voxel form' || t === 'particle form' || t === 'polygon form';
}

/** Idle animation that runs for the object's whole lifetime. */
export interface IdleAnimation {
  type: IdleType;
  /** Speed multiplier (1 = default). */
  speed: number;
  /** Axis for the rotate idle ('z' default). */
  axis: 'x' | 'y' | 'z';
}

/** Start / end transition animation (plays at the lifetime edges). */
export interface Transition {
  type: TransitionType;
  /** Duration of the transition in ms. */
  durationMs: number;
  /** Chunk fineness 0..1 for form transitions (voxel/particle/polygon). Default 0.5. */
  density?: number;
  /** Form transitions only: fill the interior with chunks too (default false = surface shell). */
  solidFill?: boolean;
}

export const defaultIdle = (): IdleAnimation => ({
  type: 'none',
  speed: 1,
  axis: 'z',
});
export const defaultTransition = (): Transition => ({
  type: 'none',
  durationMs: 500,
});

export interface SceneObject {
  id: string;
  name: string;
  type: 'mesh' | 'group';
  parentId: string | null;
  /** For meshes: the geometry asset this object references. */
  assetId: string | null;
  visible: boolean;
  lifetime: Lifetime;
  /** Base transform used for channels that have no keyframes. */
  transform: Transform;
  /** Per-value keyframe tracks. Legacy whole-pose `keyframes` are migrated here. */
  tracks: Tracks;
  /** @deprecated Legacy whole-pose keyframes; present only until migrated to `tracks`. */
  keyframes?: Keyframe[];
  /** Center of rotation, expressed as a local offset from the object origin. */
  centerOfRotation: Vec3;
  material: Material;
  /** Idle animation over the whole lifetime (optional for back-compat). */
  idle?: IdleAnimation;
  /** Start / end transition animations (optional for back-compat). */
  startAnim?: Transition;
  endAnim?: Transition;
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
  /** Media asset id of a 2D image/gif/video shown behind the scene. */
  backgroundMediaId?: string;
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

/** Reserved variable name: the render playhead in seconds (read-only, built-in). */
export const TIME_VARIABLE = 'time';

/** A named numeric value that numeric fields can be bound to (project-global). */
export interface Variable {
  id: string;
  name: string;
  /** Constant / cached fallback value (used when no expr and no keyframes). */
  value: number;
  /** Optional expression over other variables and `time`. Must not be cyclic. */
  expr?: string;
  /** Optional keyframes animating this variable's value over render time. */
  track?: ValueKeyframe[];
}

export interface Project {
  /** Document schema version, bumped on breaking format changes. */
  version: number;
  name: string;
  scenes: Scene[];
  activeSceneId: string;
  /** Geometry assets keyed by id, shared across scenes. */
  assets: Record<string, Asset>;
  /** Image/gif/video assets keyed by id, shared across scenes. */
  media: Record<string, MediaAsset>;
  /** Project-global named variables usable in numeric fields. */
  variables: Variable[];
  /** Map of field-path -> expression for live variable bindings. See state/bindings.ts. */
  bindings: Record<string, string>;
}

export const DOCUMENT_VERSION = 2;

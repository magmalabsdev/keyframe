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

/**
 * Light-emission parameters shared by `type: 'light'` objects and mesh parts
 * marked as emitters. `direction` is a local-space vector (the object's
 * rotation aims it), so gizmo-rotating an object aims its light.
 */
export interface LightParams {
  /** For mesh emitters: whether emission is on. Ignored for 'light' objects. */
  enabled: boolean;
  /** Hex color, e.g. "#ffffff". */
  color: string;
  /** Emission strength, 0..10 (candela; lights use no distance falloff). */
  intensity: number;
  /** Full cone angle in degrees. Above 180 the light shines in all directions. */
  spreadDeg: number;
  /** Cone edge softness 0 (hard edge) .. 1 (fully feathered). */
  softness: number;
  /** Local-space emission direction (unit-ish vector). */
  direction: Vec3;
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

export type SurfaceContent = 'image' | 'video' | 'text';
/** How media maps into the polygon's bounding box. */
export type SurfaceFit = 'stretch' | 'contain' | 'cover';
export type SurfaceAlign = 'left' | 'center' | 'right';
/** Vertical align of a 3D text block relative to the object origin. */
export type VerticalTextAlign = 'top' | 'center' | 'bottom';

/** A vertex of a surface polygon, in the surface's own local XY plane (mm). */
export type Point2 = [number, number];

/**
 * A flat polygonal surface showing an image, a video, or text. Rendered as an
 * ordinary flat 3D object: it transforms, keyframes, groups, and exports like
 * any mesh. Text color/opacity deliberately live on `material` so the existing
 * `color` / `opacity` channels animate them for free.
 */
export interface SurfaceParams {
  /** Polygon outline, >= 3 points. Normalized to counter-clockwise on write. */
  points: Point2[];
  content: SurfaceContent;
  /** Media asset id for 'image' / 'video' content. */
  mediaId?: string;
  /** How the media fills the polygon bounds. Defaults to 'stretch'. */
  fit?: SurfaceFit;
  /** Render the back face too (default true). */
  doubleSided?: boolean;
  /** Draw the polygon body at all. Defaults to `content !== 'text'`. */
  showBackground?: boolean;
  /** Body color when a text surface shows its background. Defaults to '#000000'. */
  backgroundColor?: string;

  /** Text content (content === 'text'). */
  text?: string;
  /** Cap height in mm (default 40). */
  fontSize?: number;
  align?: SurfaceAlign;
  /** Extra letter spacing in em (default 0). */
  letterSpacing?: number;
  /** Line height multiplier (default 1.15). */
  lineHeight?: number;
  /** Media asset id (kind 'font'); undefined = the bundled default font. */
  fontId?: string;
  /** Base typewriter reveal 0..1 when 'text.writeOn' has no keyframes (default 1). */
  writeOn?: number;
}

/**
 * Extruded 3D text. A 'text' object is a group-like container that owns one
 * 'glyph' child per non-whitespace character; editing these params reconciles
 * the children (see scene/textLayout.ts). Default color for new glyphs lives
 * on the parent's `material`; each glyph's own `material` animates it.
 */
export interface TextParams {
  /** Text content. '\n' starts a new line; no automatic wrapping. */
  text: string;
  /** Em size in mm (default 40). */
  fontSize: number;
  /** Extrusion depth in mm (default 10). Not keyframable. */
  depth: number;
  /** Horizontal align. A non-center value puts that edge of the text block at
   *  the object origin (e.g. 'left' puts the block's left edge at x=0). */
  align: SurfaceAlign;
  /** Vertical align, independent of `align`. 'top' raises the block above the
   *  object origin (elevated, as if standing on the origin); 'bottom' lets it
   *  hang below (as if pinned from above). Default 'center'. */
  vAlign?: VerticalTextAlign;
  /** Extra letter spacing in em (default 0). */
  letterSpacing: number;
  /** Line height multiplier (default 1.15). */
  lineHeight: number;
  /** Media asset id (kind 'font'); undefined = the bundled default font. */
  fontId?: string;
  /** Base typewriter reveal 0..1 when 'text.writeOn' has no keyframes (default 1). */
  writeOn?: number;
}

/** A single character of a 'text' object, always parented to it. */
export interface GlyphParams {
  /** The (non-whitespace) character this object renders. */
  char: string;
  /** Index into the parent's text string (whitespace/newlines counted). */
  index: number;
  /** Last auto-layout position; user offsets are preserved relative to it. */
  layoutPos: Vec3;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'font';

/** Metadata for an uploaded image/gif/video/audio clip. The actual blob lives in io/mediaCache.ts. */
export interface MediaAsset {
  id: string;
  name: string;
  mimeType: string;
  kind: MediaKind;
}

/**
 * A single placed audio clip on an audio track. Timing is in scene-local ms.
 * The decoded audio lives in io/audioCache.ts keyed by `mediaId`; only this
 * lightweight placement metadata is stored in the document.
 */
export interface AudioClip {
  id: string;
  name: string;
  /** Media asset id of the source audio (-> Project.media + mediaCache blob). */
  mediaId: string;
  /** Placement on the scene timeline (ms). */
  startMs: number;
  /** Trim-in: where playback starts within the source (ms). */
  offsetMs: number;
  /** Clip length on the timeline (ms). */
  durationMs: number;
  /** Decoded length of the whole source (ms), for clamping trims. */
  sourceDurationMs: number;
  /** Clip volume, 0 (silent) .. 1 (full). */
  gain: number;
  /** Loop the source within the clip's duration. */
  loop: boolean;
}

/**
 * A horizontal audio lane. Clips are kept sorted by `startMs` and never
 * overlap (butt-joined is fine) — the document store enforces this with
 * overwrite semantics, since one voice per clip means overlaps would play the
 * same source at two offsets at once.
 */
export interface AudioTrack {
  id: string;
  name: string;
  muted: boolean;
  /** Track-level volume, 0 .. 1, multiplied with each clip's gain. */
  gain: number;
  clips: AudioClip[];
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
  | 'target.0'
  | 'target.1'
  | 'target.2'
  | 'opacity'
  | 'color'
  | 'light.intensity'
  | 'light.spread'
  | 'light.softness'
  | 'light.color'
  | 'light.direction.0'
  | 'light.direction.1'
  | 'light.direction.2'
  | 'text.writeOn';

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
  type: 'mesh' | 'group' | 'light' | 'surface' | 'text' | 'glyph';
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
  /** Light emission: always present on 'light' objects, optional on meshes. */
  light?: LightParams;
  /** Polygon + content: always present on 'surface' objects. */
  surface?: SurfaceParams;
  /** Text params: always present on 'text' objects. */
  text?: TextParams;
  /** Glyph params: always present on 'glyph' objects. */
  glyph?: GlyphParams;
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

/** @deprecated Whole-pose camera keyframe — retained for migration to `tracks`. */
export interface CameraKeyframe extends CameraState {
  id: string;
  timeMs: number;
  interpolation: Easing;
}

export interface Camera {
  /** Fallback pose for any position/target axis with no keyframes. */
  default: CameraState;
  /** Per-axis keyframe tracks: position.0-2, target.0-2. */
  tracks: Tracks;
  /** @deprecated Legacy whole-pose keyframes; present only until migrated. */
  keyframes?: CameraKeyframe[];
}

export interface SceneSettings {
  backgroundColor: string;
  /** Uniform fill light so faces turned away from every placed light aren't
   *  pure black. Same units as LightParams.intensity; 0 = lit only by light
   *  objects and emitters. */
  ambientIntensity?: number;
  /** Timeline frame rate: drives frame stepping and the video export. Default 30. */
  fps?: number;
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

/** A named point of interest on the scene timeline. */
export interface Marker {
  id: string;
  timeMs: number;
  name: string;
  /** CSS color of the ruler tick. */
  color: string;
}

/**
 * Colors cycled through as markers are added. Deliberately excludes the UI
 * accent blue, which would make a marker invisible under the playhead.
 */
export const MARKER_COLORS = [
  '#22c55e',
  '#eab308',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
] as const;

export interface Scene {
  id: string;
  name: string;
  durationMs: number;
  /** Timeline markers, kept sorted by time. */
  markers?: Marker[];
  settings: SceneSettings;
  camera: Camera;
  objects: SceneObject[];
  /** Audio tracks (background music, sound effects) laid out on the timeline. */
  audioTracks: AudioTrack[];
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

export const DOCUMENT_VERSION = 6;

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { useActiveScene, useDocumentStore, useObject } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { getGeometry } from '../io/geometryCache';
import { selectAllInstances, selectExact, selectInScene } from '../scene/grouping';
import { placeObjectFaceDown } from '../scene/placeOnFace';
import { createSurfaceOnFace } from '../scene/createSurfaceOnFace';
import { ensureBoxUVs, ensureTileUVs } from '../scene/textureUv';
import { getObjectTexture, getSurfaceTexture } from '../render/mediaTextures';
import {
  buildSurfaceGeometry,
  getSurfaceGeometry,
  polygonBounds,
  polygonCentroid,
  surfaceGeometryKey,
} from '../scene/surfaceGeometry';
import { getFragmentGeometry, type FormType } from '../animation/fragments';
import { effectiveFormTransition } from '../animation/formTransition';
import { getGlyphGeometry, glyphGeometryKey } from '../scene/glyphGeometry';
import { fontKeyOf } from '../io/fonts';
import { useFontUrl, useThreeFont } from './useFont';
import { createFragmentMaterial } from '../render/fragmentMaterial';
import {
  EMISSIVE_PER_INTENSITY,
  clamp01,
  isSpotSpread,
  spotAngle,
} from '../render/lightMath';
import { defaultLightParams, defaultSurfaceParams } from '../state/defaults';
import { useFreedrag, consumeJustDragged } from './useFreedrag';
import {
  type LightParams,
  type Material,
  type Point2,
  type SceneObject,
  type SurfaceParams,
  type Transition,
} from '../state/types';

const d2r = THREE.MathUtils.degToRad;

/**
 * Hidden mesh holding the chunked "form" of a part (cubes/spheres/shards).
 * Mounted alongside the solid mesh; the pose driver shows it and drives its
 * `uProgress` uniform while a form transition is playing.
 */
function FragmentMesh({
  sourceKey,
  source,
  material,
  transition,
  name,
  position,
  side,
}: {
  /** Identifies `source` for caching: an asset id, glyph key, or polygon key. */
  sourceKey: string;
  source: THREE.BufferGeometry;
  material: Material;
  transition: Transition;
  name: string;
  position: THREE.Vector3Tuple;
  side?: THREE.Side;
}) {
  const form = transition.type as FormType;
  const density = transition.density ?? 0.5;
  const solidFill = transition.solidFill ?? false;
  const geometry = useMemo(
    () => getFragmentGeometry(sourceKey, source, form, density, solidFill),
    [sourceKey, source, form, density, solidFill],
  );
  const mat = useMemo(
    () => createFragmentMaterial(material, { side }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [material.color, material.metalness, material.roughness, material.opacity, side],
  );
  return (
    <mesh name={name} geometry={geometry} material={mat} position={position} visible={false} />
  );
}

/**
 * The three.js lights for one emitter (a 'light' object or an emitter mesh).
 * Spot + point are both always mounted with the inactive one at intensity 0
 * (see lightMath.ts for why). decay/distance 0 = no distance falloff:
 * physically-correct falloff in a mm-scale world needs unusable ~1e5 candela.
 * Initial values come from the base params; animated values are driven per
 * frame by applyObjectPose via the __spot/__point/__target node names.
 */
function LightRig({
  objId,
  light,
  position,
}: {
  objId: string;
  light: LightParams;
  position?: THREE.Vector3Tuple;
}) {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  // The spot's target must be an in-graph Object3D (its matrixWorld orients
  // the cone); a child of the same group keeps the direction local-space.
  useLayoutEffect(() => {
    if (spotRef.current && targetRef.current) spotRef.current.target = targetRef.current;
  }, []);
  const spot = isSpotSpread(light.spreadDeg);
  return (
    <group position={position}>
      <spotLight
        ref={spotRef}
        name={`${objId}__spot`}
        color={light.color}
        intensity={spot ? light.intensity : 0}
        angle={spotAngle(light.spreadDeg)}
        penumbra={clamp01(light.softness)}
        decay={0}
        distance={0}
      />
      <object3D ref={targetRef} name={`${objId}__target`} position={light.direction} />
      <pointLight
        name={`${objId}__point`}
        color={light.color}
        intensity={spot ? 0 : light.intensity}
        decay={0}
        distance={0}
      />
    </group>
  );
}

/** Editor-only stand-in for a light object: selectable glowing sphere plus a
 *  direction arrow. Excluded from render preview and video export. */
const LightObject = memo(function LightObject({
  obj,
  selected,
  children,
}: {
  obj: SceneObject;
  selected: boolean;
  children?: ReactNode;
}) {
  const renderPreview = useEditorStore((s) => s.renderPreview);
  const onFreedragDown = useFreedrag(obj.id);
  const light = obj.light ?? defaultLightParams();
  const { position, rotation, scale } = obj.transform;

  // Orients the arrow group's local -Z along the light's local direction.
  const dirQuat = useMemo(() => {
    const v = new THREE.Vector3(...light.direction);
    if (v.lengthSq() < 1e-8) v.set(0, 0, -1);
    v.normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), v);
  }, [light.direction]);

  const proxyColor = selected ? '#2554c7' : light.color;

  return (
    <group
      name={obj.id}
      position={position}
      rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
      scale={scale}
    >
      {/* Named __mesh so click-pick, right-click pick, and marquee treat it
          like any object; lightProxy makes place-on-face skip it. */}
      <mesh
        name={`${obj.id}__mesh`}
        visible={!renderPreview}
        userData={{ excludeFromRender: true, lightProxy: true, selected }}
        onPointerDown={onFreedragDown}
        onClick={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (consumeJustDragged()) return; // a freedrag just happened
          if (e.detail >= 2) selectExact(obj.id);
          else selectInScene(obj.id, e.shiftKey);
        }}
      >
        <sphereGeometry args={[12, 16, 12]} />
        <meshBasicMaterial color={proxyColor} toneMapped={false} />
      </mesh>
      <group
        name={`${obj.id}__dir`}
        quaternion={dirQuat}
        visible={!renderPreview}
        userData={{ excludeFromRender: true, lightProxy: true }}
      >
        {/* Arrow along local -Z (cylinder/cone point +Y; rotateX(-90) -> -Z). */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -26]}>
          <cylinderGeometry args={[1.5, 1.5, 28, 6]} />
          <meshBasicMaterial color={proxyColor} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -46]}>
          <coneGeometry args={[5, 12, 10]} />
          <meshBasicMaterial color={proxyColor} toneMapped={false} />
        </mesh>
      </group>
      <LightRig objId={obj.id} light={light} />
      {children}
    </group>
  );
});

const ObjectMesh = memo(function ObjectMesh({
  obj,
  selected,
  children,
}: {
  obj: SceneObject;
  selected: boolean;
  children?: ReactNode;
}) {
  const asset = useDocumentStore((s) =>
    obj.assetId ? s.project.assets[obj.assetId] : undefined,
  );
  const textureMedia = useDocumentStore((s) =>
    obj.material.textureAssetId ? s.project.media[obj.material.textureAssetId] : undefined,
  );
  const onFreedragDown = useFreedrag(obj.id);

  if (!obj.visible || !asset) return null;

  const geometry = getGeometry(asset.id);
  if (!geometry) return null;
  const { rotation, scale } = obj.transform;
  const cor = obj.centerOfRotation;
  const { color, opacity, metalness, roughness } = obj.material;

  const textureMode = obj.material.textureMode ?? 'fill';
  const textureScale = obj.material.textureScale ?? 100;

  let map: THREE.Texture | undefined;
  if (textureMedia) {
    ensureBoxUVs(geometry);
    if (textureMode === 'tile') ensureTileUVs(geometry);
    map = getObjectTexture(textureMedia, textureMode, textureScale);
  }

  const startForm = effectiveFormTransition(obj, 'start');
  const endForm = effectiveFormTransition(obj, 'end');

  // Parts marked as emitters glow (emissive) and carry a light rig. Selection
  // highlight reuses the emissive slot and wins while selected; applyPose
  // checks mesh.userData.selected before driving animated emissive values.
  const emitting = obj.light?.enabled === true;

  return (
    <group
      name={obj.id}
      position={obj.transform.position}
      rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
      scale={scale}
    >
      {/* Geometry offset by centerOfRotation so the group origin is the pivot. */}
      <mesh
        name={`${obj.id}__mesh`}
        geometry={geometry}
        position={cor}
        userData={{ selected }}
        onPointerDown={onFreedragDown}
        onClick={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (consumeJustDragged()) return; // a freedrag just happened
          const tool = useEditorStore.getState().activeTool;
          if (tool === 'place' && e.face && e.object.parent) {
            placeObjectFaceDown(obj.id, e.object.parent, e.face.normal);
            return;
          }
          if (tool === 'surface' && e.face && e.faceIndex != null) {
            createSurfaceOnFace(obj.id, e.object as THREE.Mesh, e.faceIndex, e.face.normal);
            return;
          }
          // Ctrl/Cmd-click selects every instance of this part (all objects
          // sharing its asset); double-click drills into a group; single click
          // selects the whole group.
          if (e.metaKey || e.ctrlKey) selectAllInstances(obj.id);
          else if (e.detail >= 2) selectExact(obj.id);
          else selectInScene(obj.id, e.shiftKey);
        }}
      >
        {/* Key by UV-channel config so the material recompiles when switching
            fill (uv) <-> tile (uv1): three only recompiles on material.version
            changes, not on a map.channel change. */}
        <meshStandardMaterial
          key={`mat-${map ? textureMode : 'none'}`}
          color={color}
          map={map ?? null}
          transparent={opacity < 1}
          opacity={opacity}
          metalness={metalness}
          roughness={roughness}
          emissive={selected ? '#2554c7' : emitting ? obj.light!.color : '#000000'}
          emissiveIntensity={
            selected ? 0.45 : emitting ? EMISSIVE_PER_INTENSITY * obj.light!.intensity : 0
          }
        />
      </mesh>
      {emitting && <LightRig objId={obj.id} light={obj.light!} position={cor} />}
      {startForm && (
        <FragmentMesh
          sourceKey={asset.id}
          source={geometry}
          material={obj.material}
          transition={startForm}
          name={`${obj.id}__fragStart`}
          position={cor}
        />
      )}
      {endForm && (
        <FragmentMesh
          sourceKey={asset.id}
          source={geometry}
          material={obj.material}
          transition={endForm}
          name={`${obj.id}__fragEnd`}
          position={cor}
        />
      )}
      {children}
    </group>
  );
});

/**
 * One extruded character of a 'text' object. Font/size/depth come from the
 * parent (so a parent edit restyles every glyph); placement is this object's
 * own transform, written by the text reconciler. Geometry is shared per
 * (font, char, size, depth) via the glyph LRU, which owns disposal.
 */
const GlyphObject = memo(function GlyphObject({
  obj,
  selected,
  children,
}: {
  obj: SceneObject;
  selected: boolean;
  children?: ReactNode;
}) {
  const parent = useObject(obj.parentId ?? undefined);
  const text = parent?.type === 'text' ? parent.text : undefined;
  const font = useThreeFont(text?.fontId);
  const onFreedragDown = useFreedrag(obj.id);

  const fontId = text?.fontId;
  const fontSize = text?.fontSize ?? 40;
  const depth = text?.depth ?? 10;
  const char = obj.glyph?.char ?? '?';
  const geometryKey = glyphGeometryKey(fontKeyOf(fontId), char, fontSize, depth);
  const geometry = useMemo(
    () => (font ? getGlyphGeometry(fontKeyOf(fontId), font, char, fontSize, depth) : null),
    [font, fontId, char, fontSize, depth],
  );

  if (!obj.visible || !geometry) return null;

  const { rotation, scale } = obj.transform;
  const cor = obj.centerOfRotation;
  const { color, opacity, metalness, roughness } = obj.material;
  // Form transitions set on the parent text cascade to every character, so the
  // whole word fragments as one; a transition on this glyph overrides it.
  const startForm = effectiveFormTransition(obj, 'start', parent);
  const endForm = effectiveFormTransition(obj, 'end', parent);

  return (
    <group
      name={obj.id}
      position={obj.transform.position}
      rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
      scale={scale}
    >
      {/* Geometry offset by centerOfRotation so the group origin is the pivot. */}
      <mesh
        name={`${obj.id}__mesh`}
        geometry={geometry}
        position={cor}
        userData={{ selected }}
        onPointerDown={onFreedragDown}
        onClick={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (consumeJustDragged()) return; // a freedrag just happened
          const tool = useEditorStore.getState().activeTool;
          if (tool === 'place' && e.face && e.object.parent) {
            placeObjectFaceDown(obj.id, e.object.parent, e.face.normal);
            return;
          }
          if (tool === 'surface' && e.face && e.faceIndex != null) {
            createSurfaceOnFace(obj.id, e.object as THREE.Mesh, e.faceIndex, e.face.normal);
            return;
          }
          // Single click selects the whole text; double-click drills to the
          // character (same semantics as group members).
          if (e.metaKey || e.ctrlKey) selectAllInstances(obj.id);
          else if (e.detail >= 2) selectExact(obj.id);
          else selectInScene(obj.id, e.shiftKey);
        }}
      >
        <meshStandardMaterial
          color={color}
          transparent={opacity < 1}
          opacity={opacity}
          metalness={metalness}
          roughness={roughness}
          emissive={selected ? '#2554c7' : '#000000'}
          emissiveIntensity={selected ? 0.45 : 0}
        />
      </mesh>
      {startForm && (
        <FragmentMesh
          sourceKey={geometryKey}
          source={geometry}
          material={obj.material}
          transition={startForm}
          name={`${obj.id}__fragStart`}
          position={cor}
        />
      )}
      {endForm && (
        <FragmentMesh
          sourceKey={geometryKey}
          source={geometry}
          material={obj.material}
          transition={endForm}
          name={`${obj.id}__fragEnd`}
          position={cor}
        />
      )}
      {children}
    </group>
  );
});

/** Lifts glyphs off the polygon body so they don't z-fight it (mm). */
const TEXT_Z_OFFSET = 0.2;

/**
 * SDF text sitting on a surface's polygon.
 *
 * Two troika contracts are load-bearing here:
 *  - No `color` prop: troika stamps the material's color from that prop every
 *    frame, which would silently erase the pose driver's animated color. It
 *    goes on the child material instead.
 *  - No `outline*` props: any of them makes `.material` an array, which the
 *    pose driver would have to unwrap.
 *
 * The material is a `meshBasicMaterial` (unlit), not `meshStandardMaterial`.
 * The scene's ambient fill can be dialed to 0, leaving only user-placed Light
 * objects, and a physically-lit face receives ~zero light unless it happens to
 * face one — which text stamped on the side of an object rarely does. Lit text
 * would then wash out toward black regardless of its chosen color. Text is a
 * label, not a shaded surface, so its color should always be exactly what's
 * picked in the inspector.
 */
function SurfaceText({
  objId,
  surface,
  material,
  side,
  center,
  maxWidth,
}: {
  objId: string;
  surface: SurfaceParams;
  material: Material;
  side: THREE.Side;
  center: THREE.Vector3Tuple;
  maxWidth: number;
}) {
  const invalidate = useThree((s) => s.invalidate);
  // Embedded project font, or the bundled font (troika's own fallback would
  // fetch from a jsdelivr CDN, so text must always get an explicit URL).
  const fontUrl = useFontUrl(surface.fontId);
  return (
    <Text
      name={`${objId}__text`}
      // Named __text (not __mesh) and non-raycastable so picking, marquee, and
      // face highlighting all go to the polygon underneath instead of troika's
      // synthetic quad, whose faceIndex doesn't match its real geometry.
      userData={{ troikaText: true, excludeFromRender: false }}
      raycast={() => null}
      position={center}
      font={fontUrl}
      fontSize={surface.fontSize ?? 40}
      maxWidth={maxWidth}
      textAlign={surface.align ?? 'center'}
      anchorX="center"
      anchorY="middle"
      letterSpacing={surface.letterSpacing ?? 0}
      lineHeight={surface.lineHeight ?? 1.15}
      // Glyph layout finishes in a worker on a later tick; the frameloop is
      // on-demand, so without this the first paint stays blank.
      onSync={() => invalidate()}
    >
      {surface.text ?? ''}
      <meshBasicMaterial
        color={material.color}
        side={side}
        transparent
        opacity={material.opacity}
      />
    </Text>
  );
}

/**
 * Triangulated polygon for a surface. While its vertices are being dragged the
 * points change every pointermove, so build uncached (and dispose on change)
 * rather than flooding the shared LRU with hundreds of dead entries.
 */
function useSurfaceGeometry(points: Point2[], live: boolean): THREE.BufferGeometry {
  const key = points.map((p) => p.join()).join(';');
  const geometry = useMemo(
    () => (live ? buildSurfaceGeometry(points) : getSurfaceGeometry(points)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, live],
  );
  useEffect(() => {
    if (!live) return; // cached geometries are owned by the cache
    return () => geometry.dispose();
  }, [geometry, live]);
  return geometry;
}

/**
 * A flat polygonal surface showing an image, a video, or text.
 *
 * All three content modes render the same `__mesh` polygon; text is an extra
 * `__text` child on top of it, never a replacement. That keeps picking,
 * marquee, the gizmo, and vertex editing identical across content modes and
 * gives the pose driver a single shape to reason about.
 */
const SurfaceObject = memo(function SurfaceObject({
  obj,
  selected,
  children,
}: {
  obj: SceneObject;
  selected: boolean;
  children?: ReactNode;
}) {
  const surface = obj.surface ?? defaultSurfaceParams();
  const media = useDocumentStore((s) =>
    surface.mediaId ? s.project.media[surface.mediaId] : undefined,
  );
  // Live outline while this surface's vertices are being dragged.
  const preview = useEditorStore((s) =>
    s.surfaceEditId === obj.id ? s.surfacePreviewPoints : null,
  );
  const onFreedragDown = useFreedrag(obj.id);

  const points = preview ?? surface.points;
  const geometry = useSurfaceGeometry(points, preview != null);

  if (!obj.visible) return null;

  const { rotation, scale } = obj.transform;
  const cor = obj.centerOfRotation;
  const isText = surface.content === 'text';
  const side = (surface.doubleSided ?? true) ? THREE.DoubleSide : THREE.FrontSide;
  const showBg = surface.showBackground ?? !isText;
  const bounds = polygonBounds(points);
  const [cx, cy] = polygonCentroid(points);

  const map =
    !isText && media
      ? getSurfaceTexture(media, surface.fit ?? 'stretch', bounds.w / (bounds.h || 1))
      : undefined;

  // Only the polygon body can fragment. Text surfaces are excluded: troika's
  // geometry is instanced SDF quads (chunking it scatters transparent quads,
  // not letterforms) and their backdrop is hidden by default, so fragmenting
  // one would just make the text vanish — 3D text objects are the path there.
  // Keyed off the committed points, never the live drag preview, so dragging a
  // vertex doesn't push a fragment geometry into the LRU on every pointermove.
  const startForm = isText ? null : effectiveFormTransition(obj, 'start');
  const endForm = isText ? null : effectiveFormTransition(obj, 'end');
  const fragKey = startForm || endForm ? surfaceGeometryKey(surface.points) : '';
  const fragSource =
    startForm || endForm ? getSurfaceGeometry(surface.points) : undefined;

  return (
    <group
      name={obj.id}
      position={obj.transform.position}
      rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
      scale={scale}
    >
      <mesh
        name={`${obj.id}__mesh`}
        geometry={geometry}
        position={cor}
        // surfaceMesh keeps place-on-face from treating a decal as a target.
        userData={{ selected, surfaceMesh: true }}
        onPointerDown={onFreedragDown}
        onClick={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (consumeJustDragged()) return; // a freedrag just happened
          if (e.metaKey || e.ctrlKey) selectAllInstances(obj.id);
          else if (e.detail >= 2) selectExact(obj.id);
          else selectInScene(obj.id, e.shiftKey);
        }}
      >
        {/* Keyed like ObjectMesh's: three only recompiles on material.version
            changes, so gaining/losing a map needs a fresh material. */}
        <meshStandardMaterial
          key={`surf-${map ? 'map' : 'none'}`}
          color={isText ? (surface.backgroundColor ?? '#000000') : obj.material.color}
          map={map ?? null}
          side={side}
          // A hidden body still has to be pickable, so it stays mounted at
          // opacity 0 rather than being unmounted.
          transparent={!showBg || obj.material.opacity < 1}
          opacity={showBg ? obj.material.opacity : 0}
          depthWrite={showBg}
          metalness={obj.material.metalness}
          roughness={obj.material.roughness}
          emissive={selected ? '#2554c7' : '#000000'}
          emissiveIntensity={selected ? 0.45 : 0}
        />
      </mesh>
      {isText && (
        <SurfaceText
          objId={obj.id}
          surface={surface}
          material={obj.material}
          side={side}
          center={[cor[0] + cx, cor[1] + cy, cor[2] + TEXT_Z_OFFSET]}
          maxWidth={bounds.w}
        />
      )}
      {startForm && fragSource && (
        <FragmentMesh
          sourceKey={fragKey}
          source={fragSource}
          material={obj.material}
          transition={startForm}
          name={`${obj.id}__fragStart`}
          position={cor}
          side={side}
        />
      )}
      {endForm && fragSource && (
        <FragmentMesh
          sourceKey={fragKey}
          source={fragSource}
          material={obj.material}
          transition={endForm}
          name={`${obj.id}__fragEnd`}
          position={cor}
          side={side}
        />
      )}
      {children}
    </group>
  );
});

type ChildrenMap = Map<string | null, SceneObject[]>;

/**
 * Renders one scene node. Subscribes to ITS OWN selection so selecting one
 * object only re-renders that node (not all N). The heavy work lives in the
 * memoized ObjectMesh, which only re-runs when its `obj` identity (immer
 * preserves it for unchanged objects) or `selected` actually changes.
 *
 * Any object kind can hold children (surfaces parent to the mesh they were
 * placed on), so children are built once here and handed to whichever leaf
 * component renders them inside its `<group name={obj.id}>`.
 */
function Node({
  obj,
  childrenMap,
  ancestorSelected,
}: {
  obj: SceneObject;
  childrenMap: ChildrenMap;
  ancestorSelected: boolean;
}) {
  const selfSelected = useEditorStore((s) => s.selectedIds.includes(obj.id));
  const isSelected = ancestorSelected || selfSelected;

  // Stay on a stable `null` for childless leaves (nearly all of them): a fresh
  // array identity every render would defeat memo() on every mesh in a scene.
  const kidObjs = childrenMap.get(obj.id);
  const kids = kidObjs?.length
    ? kidObjs.map((c) => (
        <Node key={c.id} obj={c} childrenMap={childrenMap} ancestorSelected={isSelected} />
      ))
    : null;

  // Text containers render exactly like groups: a transform-carrying group
  // whose children (the glyphs) do the actual drawing.
  if (obj.type === 'group' || obj.type === 'text') {
    if (!obj.visible) return null;
    const { position, rotation, scale } = obj.transform;
    return (
      <group
        name={obj.id}
        position={position}
        rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
        scale={scale}
      >
        {kids}
      </group>
    );
  }

  if (obj.type === 'glyph') {
    return (
      <GlyphObject obj={obj} selected={isSelected}>
        {kids}
      </GlyphObject>
    );
  }

  if (obj.type === 'light') {
    return (
      <LightObject obj={obj} selected={isSelected}>
        {kids}
      </LightObject>
    );
  }

  if (obj.type === 'surface') {
    return (
      <SurfaceObject obj={obj} selected={isSelected}>
        {kids}
      </SurfaceObject>
    );
  }

  return (
    <ObjectMesh obj={obj} selected={isSelected}>
      {kids}
    </ObjectMesh>
  );
}

export function SceneObjects() {
  const objects = useActiveScene().objects;
  // Group children by parent once (O(N)) instead of filtering per group.
  const childrenMap = useMemo(() => {
    const map: ChildrenMap = new Map();
    for (const o of objects) {
      const key = o.parentId ?? null;
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [objects]);

  return (
    <>
      {(childrenMap.get(null) ?? []).map((o) => (
        <Node key={o.id} obj={o} childrenMap={childrenMap} ancestorSelected={false} />
      ))}
    </>
  );
}

import { memo, useMemo } from 'react';
import * as THREE from 'three';
import { useActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { getGeometry } from '../io/geometryCache';
import { selectAllInstances, selectExact, selectInScene } from '../scene/grouping';
import { placeObjectFaceDown } from '../scene/placeOnFace';
import { ensureBoxUVs, ensureTileUVs } from '../scene/textureUv';
import { getObjectTexture } from '../render/mediaTextures';
import { getFragmentGeometry, type FormType } from '../animation/fragments';
import { createFragmentMaterial } from '../render/fragmentMaterial';
import { useFreedrag, consumeJustDragged } from './useFreedrag';
import { isFormTransition, type Asset, type Material, type SceneObject, type Transition } from '../state/types';

const d2r = THREE.MathUtils.degToRad;

/**
 * Hidden mesh holding the chunked "form" of a part (cubes/spheres/shards).
 * Mounted alongside the solid mesh; the pose driver shows it and drives its
 * `uProgress` uniform while a form transition is playing.
 */
function FragmentMesh({
  asset,
  material,
  transition,
  name,
  position,
}: {
  asset: Asset;
  material: Material;
  transition: Transition;
  name: string;
  position: THREE.Vector3Tuple;
}) {
  const form = transition.type as FormType;
  const density = transition.density ?? 0.5;
  const solidFill = transition.solidFill ?? false;
  const geometry = useMemo(
    () => getFragmentGeometry(asset, form, density, solidFill),
    [asset, form, density, solidFill],
  );
  const mat = useMemo(
    () => createFragmentMaterial(material),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [material.color, material.metalness, material.roughness, material.opacity],
  );
  return (
    <mesh name={name} geometry={geometry} material={mat} position={position} visible={false} />
  );
}

const ObjectMesh = memo(function ObjectMesh({
  obj,
  selected,
}: {
  obj: SceneObject;
  selected: boolean;
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

  const startForm =
    obj.startAnim && isFormTransition(obj.startAnim.type) ? obj.startAnim : null;
  const endForm =
    obj.endAnim && isFormTransition(obj.endAnim.type) ? obj.endAnim : null;

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
          emissive={selected ? '#2554c7' : '#000000'}
          emissiveIntensity={selected ? 0.45 : 0}
        />
      </mesh>
      {startForm && (
        <FragmentMesh
          asset={asset}
          material={obj.material}
          transition={startForm}
          name={`${obj.id}__fragStart`}
          position={cor}
        />
      )}
      {endForm && (
        <FragmentMesh
          asset={asset}
          material={obj.material}
          transition={endForm}
          name={`${obj.id}__fragEnd`}
          position={cor}
        />
      )}
    </group>
  );
});

type ChildrenMap = Map<string | null, SceneObject[]>;

/**
 * Renders one scene node. Subscribes to ITS OWN selection so selecting one
 * object only re-renders that node (not all N). The heavy work lives in the
 * memoized ObjectMesh, which only re-runs when its `obj` identity (immer
 * preserves it for unchanged objects) or `selected` actually changes.
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

  if (obj.type === 'group') {
    if (!obj.visible) return null;
    const { position, rotation, scale } = obj.transform;
    return (
      <group
        name={obj.id}
        position={position}
        rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
        scale={scale}
      >
        {(childrenMap.get(obj.id) ?? []).map((c) => (
          <Node
            key={c.id}
            obj={c}
            childrenMap={childrenMap}
            ancestorSelected={isSelected}
          />
        ))}
      </group>
    );
  }

  return <ObjectMesh obj={obj} selected={isSelected} />;
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

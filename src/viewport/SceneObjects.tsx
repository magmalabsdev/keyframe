import * as THREE from 'three';
import { useActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { getGeometry } from '../io/geometryCache';
import { selectExact, selectInScene } from '../scene/grouping';
import { childrenOf } from '../scene/tree';
import { placeObjectFaceDown } from '../scene/placeOnFace';
import { useFreedrag, consumeJustDragged } from './useFreedrag';
import type { SceneObject } from '../state/types';

const d2r = THREE.MathUtils.degToRad;

function ObjectMesh({ obj, selected }: { obj: SceneObject; selected: boolean }) {
  const asset = useDocumentStore((s) =>
    obj.assetId ? s.project.assets[obj.assetId] : undefined,
  );
  const onFreedragDown = useFreedrag(obj.id);

  if (!obj.visible || !asset) return null;

  const geometry = getGeometry(asset);
  const { rotation, scale } = obj.transform;
  const cor = obj.centerOfRotation;
  const { color, opacity, metalness, roughness } = obj.material;

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
          // Single click selects the whole group; double-click drills to child.
          if (e.detail >= 2) selectExact(obj.id);
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
    </group>
  );
}

function Node({
  obj,
  objects,
  selected,
  ancestorSelected,
}: {
  obj: SceneObject;
  objects: SceneObject[];
  selected: Set<string>;
  ancestorSelected: boolean;
}) {
  const isSelected = ancestorSelected || selected.has(obj.id);

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
        {childrenOf(objects, obj.id).map((c) => (
          <Node
            key={c.id}
            obj={c}
            objects={objects}
            selected={selected}
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
  const selected = new Set(useEditorStore((s) => s.selectedIds));
  const roots = objects.filter((o) => !o.parentId);
  return (
    <>
      {roots.map((o) => (
        <Node
          key={o.id}
          obj={o}
          objects={objects}
          selected={selected}
          ancestorSelected={false}
        />
      ))}
    </>
  );
}

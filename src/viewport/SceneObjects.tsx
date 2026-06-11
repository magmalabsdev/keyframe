import * as THREE from 'three';
import { useActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { getGeometry } from '../io/geometryCache';
import type { SceneObject } from '../state/types';

const d2r = THREE.MathUtils.degToRad;

function ObjectMesh({ obj }: { obj: SceneObject }) {
  const asset = useDocumentStore((s) =>
    obj.assetId ? s.project.assets[obj.assetId] : undefined,
  );
  const selected = useEditorStore((s) => s.selectedIds.includes(obj.id));
  const toggleSelection = useEditorStore((s) => s.toggleSelection);

  if (!obj.visible || !asset) return null;

  const geometry = getGeometry(asset);
  const { position, rotation, scale } = obj.transform;
  const { color, opacity, metalness, roughness } = obj.material;

  return (
    <mesh
      name={obj.id}
      geometry={geometry}
      position={position}
      rotation={[d2r(rotation[0]), d2r(rotation[1]), d2r(rotation[2])]}
      scale={scale}
      onPointerDown={(e) => {
        // Left button only; right/middle are camera controls.
        if (e.button !== 0) return;
        e.stopPropagation();
        toggleSelection(obj.id, e.shiftKey);
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
  );
}

export function SceneObjects() {
  const objects = useActiveScene().objects;
  return (
    <>
      {objects.map((o) => (
        <ObjectMesh key={o.id} obj={o} />
      ))}
    </>
  );
}

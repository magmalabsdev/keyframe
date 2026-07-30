import * as THREE from 'three';
import { nanoid } from 'nanoid';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { defaultMaterial } from '../state/defaults';
import { getR3F } from '../render/renderApi';
import { childrenOf, topLevelAncestor } from './tree';
import type { SceneObject, Transform, Vec3 } from '../state/types';

const r2d = THREE.MathUtils.radToDeg;

function activeObjects(): SceneObject[] {
  return getActiveScene(useDocumentStore.getState().project).objects;
}

/** Single-click selection: select the clicked object's top-level group. */
export function selectInScene(id: string, additive: boolean): void {
  const top = topLevelAncestor(activeObjects(), id);
  useEditorStore.getState().toggleSelection(top, additive);
}

/** Double-click selection: select the exact object (drill into a group). */
export function selectExact(id: string): void {
  useEditorStore.getState().setSelection([id]);
}

/**
 * Ctrl/Cmd-click selection: select every instance of the clicked part — all
 * objects sharing its asset (duplicates/pastes keep the same assetId). Falls
 * back to selecting just the clicked object if it has no asset.
 */
export function selectAllInstances(id: string): void {
  const objects = activeObjects();
  const clicked = objects.find((o) => o.id === id);
  const assetId = clicked?.assetId;
  if (!assetId) {
    useEditorStore.getState().setSelection([id]);
    return;
  }
  const ids = objects.filter((o) => o.assetId === assetId).map((o) => o.id);
  useEditorStore.getState().setSelection(ids);
}

/** Group the current multi-selection into a new group at their combined center. */
export function groupSelection(): void {
  const ids = useEditorStore.getState().selectedIds;
  if (ids.length < 2) return;
  // Glyphs stay children of their text object (reparenting one would orphan
  // it from the layout/reconciler), so they can't be grouped away.
  const objs = activeObjects().filter((o) => ids.includes(o.id) && o.type !== 'glyph');
  if (objs.length < 2) return;

  // Center = center of the smallest cuboid holding all selected objects.
  const center = new THREE.Vector3();
  const three = getR3F()?.scene;
  const box = new THREE.Box3();
  if (three) {
    three.updateMatrixWorld(true);
    for (const o of objs) {
      const m = three.getObjectByName(o.id);
      if (m) box.expandByObject(m);
    }
  }
  if (!box.isEmpty()) box.getCenter(center);
  else {
    for (const o of objs) center.add(new THREE.Vector3(...o.transform.position));
    center.multiplyScalar(1 / objs.length);
  }
  const centerArr: Vec3 = [center.x, center.y, center.z];

  const group: SceneObject = {
    id: nanoid(),
    name: 'Group',
    type: 'group',
    parentId: objs[0].parentId ?? null,
    assetId: null,
    visible: true,
    lifetime: {
      startMs: Math.min(...objs.map((o) => o.lifetime.startMs)),
      endMs: Math.max(...objs.map((o) => o.lifetime.endMs)),
    },
    transform: { position: centerArr, rotation: [0, 0, 0], scale: [1, 1, 1] },
    tracks: {},
    centerOfRotation: [0, 0, 0],
    material: defaultMaterial(),
  };

  // Children are top-level, so their world position equals their local position;
  // the group has identity rotation/scale, so local = world - center.
  const localPositions: Record<string, Vec3> = {};
  for (const o of objs) {
    localPositions[o.id] = [
      o.transform.position[0] - center.x,
      o.transform.position[1] - center.y,
      o.transform.position[2] - center.z,
    ];
  }

  useDocumentStore.getState().groupObjects(group, objs.map((o) => o.id), localPositions);
  useEditorStore.getState().setSelection([group.id]);
}

/** Ungroup any selected groups, baking world transforms back onto children. */
export function ungroupSelection(): void {
  const ids = useEditorStore.getState().selectedIds;
  const objs = activeObjects();
  for (const id of ids) {
    if (objs.find((o) => o.id === id && o.type === 'group')) ungroupOne(id);
  }
}

function ungroupOne(groupId: string): void {
  const objects = activeObjects();
  const group = objects.find((o) => o.id === groupId);
  if (!group) return;
  const children = childrenOf(objects, groupId);
  const newParentId = group.parentId ?? null;
  const three = getR3F()?.scene;

  const updates: { id: string; parentId: string | null; transform: Transform }[] = [];
  if (three) {
    three.updateMatrixWorld(true);
    const newParentThree = newParentId ? three.getObjectByName(newParentId) : null;
    const invParent = new THREE.Matrix4();
    if (newParentThree) invParent.copy(newParentThree.matrixWorld).invert();
    for (const c of children) {
      const cm = three.getObjectByName(c.id);
      if (!cm) {
        updates.push({ id: c.id, parentId: newParentId, transform: c.transform });
        continue;
      }
      const world = cm.matrixWorld.clone();
      const local = newParentThree ? invParent.clone().multiply(world) : world;
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      local.decompose(pos, quat, scl);
      const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
      updates.push({
        id: c.id,
        parentId: newParentId,
        transform: {
          position: [pos.x, pos.y, pos.z],
          rotation: [r2d(e.x), r2d(e.y), r2d(e.z)],
          scale: [scl.x, scl.y, scl.z],
        },
      });
    }
  } else {
    for (const c of children) {
      updates.push({ id: c.id, parentId: newParentId, transform: c.transform });
    }
  }

  useDocumentStore.getState().ungroupObjects(groupId, updates);
  useEditorStore.getState().setSelection(children.map((c) => c.id));
}

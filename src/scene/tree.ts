import type { SceneObject } from '../state/types';

/** Direct children of a parent (or top-level objects when parentId is null). */
export function childrenOf(
  objects: SceneObject[],
  parentId: string | null,
): SceneObject[] {
  return objects.filter((o) => (o.parentId ?? null) === parentId);
}

/** Walk up parentId links to the top-level ancestor of an object. */
export function topLevelAncestor(objects: SceneObject[], id: string): string {
  const byId = new Map(objects.map((o) => [o.id, o]));
  let current = byId.get(id);
  while (current && current.parentId && byId.has(current.parentId)) {
    current = byId.get(current.parentId);
  }
  return current ? current.id : id;
}

/**
 * Depth-first visual order: roots in array order, each followed by its children
 * recursively. Any object can hold children (a surface parents to the mesh it
 * was placed on), not just groups.
 */
export function flattenTree(objects: SceneObject[]): SceneObject[] {
  const result: SceneObject[] = [];
  const visit = (parentId: string | null) => {
    for (const o of childrenOf(objects, parentId)) {
      result.push(o);
      visit(o.id);
    }
  };
  visit(null);
  return result;
}

/** All descendant ids of an object (excluding itself). */
export function descendantIds(objects: SceneObject[], id: string): string[] {
  const result: string[] = [];
  const stack = [id];
  while (stack.length) {
    const parent = stack.pop()!;
    for (const o of objects) {
      if (o.parentId === parent) {
        result.push(o.id);
        stack.push(o.id);
      }
    }
  }
  return result;
}

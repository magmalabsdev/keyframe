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

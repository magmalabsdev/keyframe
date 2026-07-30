import type { Project, Variable } from '../state/types';
import { TIME_VARIABLE } from '../state/types';
import { evaluateExpr, identifiers } from '../state/expr';
import { evaluateTrack } from './evaluate';

/**
 * Resolves every project variable to a number at a given render time.
 *
 * Resolution order per variable:
 *   1. If it has keyframes (`track`), interpolate them at `timeMs`.
 *   2. Else if it has an `expr`, resolve the variables it references first,
 *      then evaluate the expression (with `time` available).
 *   3. Else use its constant `value`.
 *
 * A reserved `time` entry (playhead seconds) is always present. Cycles are
 * guarded by a visiting set and fall back to the variable's constant value.
 */
export function resolveVariables(
  project: Project,
  timeMs: number,
): Record<string, number> {
  const out: Record<string, number> = { [TIME_VARIABLE]: timeMs / 1000 };
  const byName = new Map<string, Variable>();
  for (const v of project.variables ?? []) byName.set(v.name, v);

  const visiting = new Set<string>();

  const resolve = (v: Variable): number => {
    if (v.name in out) return out[v.name];
    if (visiting.has(v.name)) return v.value; // cycle guard
    visiting.add(v.name);

    let result: number;
    if (v.track && v.track.length > 0) {
      result = evaluateTrack(v.track, timeMs, v.value);
    } else if (v.expr && v.expr.trim()) {
      for (const dep of identifiers(v.expr)) {
        const depVar = byName.get(dep);
        if (depVar && !(dep in out)) resolve(depVar);
      }
      const evaluated = evaluateExpr(v.expr, out);
      result = evaluated ?? v.value;
    } else {
      result = v.value;
    }

    visiting.delete(v.name);
    out[v.name] = result;
    return result;
  };

  for (const v of project.variables ?? []) resolve(v);
  return out;
}

/**
 * Would assigning `expr` to variable `id` create a dependency cycle (including
 * a direct self-reference)? Used to reject invalid variable expressions.
 */
export function wouldCreateCycle(
  variables: Variable[],
  id: string,
  expr: string,
): boolean {
  const self = variables.find((v) => v.id === id);
  if (!self) return false;
  const byName = new Map(variables.map((v) => [v.name, v]));

  // Dependency edges: a variable depends on the names in its expr; for `id`,
  // use the proposed new expr instead of its stored one.
  const depsOf = (v: Variable): string[] =>
    v.id === id ? identifiers(expr) : v.expr ? identifiers(v.expr) : [];

  // DFS from the proposed deps; a cycle exists if we can reach `self.name`.
  const seen = new Set<string>();
  const stack = [...depsOf(self)];
  while (stack.length) {
    const name = stack.pop()!;
    if (name === self.name) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    const next = byName.get(name);
    if (next) stack.push(...depsOf(next));
  }
  return false;
}

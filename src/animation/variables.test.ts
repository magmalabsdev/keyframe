import { describe, it, expect } from 'vitest';
import type { Project, Variable } from '../state/types';
import { resolveVariables, wouldCreateCycle } from './variables';

function project(variables: Variable[]): Project {
  return {
    version: 2,
    name: 't',
    scenes: [],
    activeSceneId: '',
    assets: {},
    media: {},
    variables,
    bindings: {},
  };
}

describe('resolveVariables', () => {
  it('exposes `time` in seconds', () => {
    const vars = resolveVariables(project([]), 2500);
    expect(vars.time).toBe(2.5);
  });

  it('resolves constants and expressions of other variables', () => {
    const p = project([
      { id: '1', name: 'a', value: 10 },
      { id: '2', name: 'b', value: 0, expr: 'a * 2' },
    ]);
    const vars = resolveVariables(p, 0);
    expect(vars.a).toBe(10);
    expect(vars.b).toBe(20);
  });

  it('lets expressions reference `time`', () => {
    const p = project([{ id: '1', name: 'x', value: 0, expr: 'time * 100' }]);
    expect(resolveVariables(p, 1000).x).toBe(100);
    expect(resolveVariables(p, 3000).x).toBe(300);
  });

  it('interpolates a keyframed variable over time', () => {
    const p = project([
      {
        id: '1',
        name: 'b',
        value: 0,
        track: [
          { id: 'k0', timeMs: 0, value: 0, interpolation: 'linear' },
          { id: 'k1', timeMs: 1000, value: 10, interpolation: 'linear' },
        ],
      },
      { id: '2', name: 'a', value: 0, expr: 'b * 2' },
    ]);
    const vars = resolveVariables(p, 500);
    expect(vars.b).toBeCloseTo(5, 5);
    expect(vars.a).toBeCloseTo(10, 5); // a = b*2 with the animated b
  });

  it('falls back to the constant value on a cycle', () => {
    // a -> b -> a (cyclic); resolution must terminate using fallbacks.
    const p = project([
      { id: '1', name: 'a', value: 7, expr: 'b' },
      { id: '2', name: 'b', value: 3, expr: 'a' },
    ]);
    const vars = resolveVariables(p, 0);
    expect(Number.isFinite(vars.a)).toBe(true);
    expect(Number.isFinite(vars.b)).toBe(true);
  });
});

describe('wouldCreateCycle', () => {
  const vars: Variable[] = [
    { id: '1', name: 'a', value: 0, expr: 'b' },
    { id: '2', name: 'b', value: 0 },
  ];
  it('detects direct self-reference', () => {
    expect(wouldCreateCycle(vars, '2', 'b')).toBe(true);
  });
  it('detects indirect cycles', () => {
    // b = a would form a -> b -> a
    expect(wouldCreateCycle(vars, '2', 'a')).toBe(true);
  });
  it('allows acyclic expressions', () => {
    expect(wouldCreateCycle(vars, '2', '5 + 1')).toBe(false);
  });
});

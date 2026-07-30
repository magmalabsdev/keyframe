import { describe, it, expect } from 'vitest';
import { evaluateExpr, identifiers, isPlainNumber, renameIdentifier, varsMap } from './expr';

const vars = { width: 100, gap: 5, h: 2 };

describe('evaluateExpr', () => {
  it('evaluates plain numbers and decimals', () => {
    expect(evaluateExpr('42', {})).toBe(42);
    expect(evaluateExpr('3.5', {})).toBe(3.5);
    expect(evaluateExpr('-7', {})).toBe(-7);
  });

  it('resolves variables and arithmetic with precedence', () => {
    expect(evaluateExpr('width', vars)).toBe(100);
    expect(evaluateExpr('width*2', vars)).toBe(200);
    expect(evaluateExpr('width/2 + gap', vars)).toBe(55);
    expect(evaluateExpr('width + gap*h', vars)).toBe(110);
    expect(evaluateExpr('(width + gap) * h', vars)).toBe(210);
  });

  it('supports unary minus and modulo', () => {
    expect(evaluateExpr('-width', vars)).toBe(-100);
    expect(evaluateExpr('width % 30', vars)).toBe(10);
  });

  it('returns null for unknown variables or malformed input', () => {
    expect(evaluateExpr('nope', vars)).toBeNull();
    expect(evaluateExpr('width *', vars)).toBeNull();
    expect(evaluateExpr('(1+2', vars)).toBeNull();
    expect(evaluateExpr('', vars)).toBeNull();
    expect(evaluateExpr('1/0', vars)).toBeNull(); // non-finite
  });

  it('never executes arbitrary code (no JS globals)', () => {
    expect(evaluateExpr('alert', vars)).toBeNull();
    expect(evaluateExpr('width.constructor', vars)).toBeNull();
  });
});

describe('isPlainNumber', () => {
  it('distinguishes literals from expressions', () => {
    expect(isPlainNumber('42')).toBe(true);
    expect(isPlainNumber(' -3.5 ')).toBe(true);
    expect(isPlainNumber('width')).toBe(false);
    expect(isPlainNumber('1+1')).toBe(false);
  });
});

describe('renameIdentifier', () => {
  it('replaces whole identifiers only', () => {
    expect(renameIdentifier('width*2 + widthX', 'width', 'w')).toBe('w*2 + widthX');
    expect(renameIdentifier('gap', 'width', 'w')).toBe('gap');
  });
});

describe('identifiers', () => {
  it('extracts distinct variable names', () => {
    expect(identifiers('width*2 + gap - width').sort()).toEqual(['gap', 'width']);
    expect(identifiers('1 + 2')).toEqual([]);
    expect(identifiers('time')).toEqual(['time']);
  });
});

describe('varsMap', () => {
  it('builds a name->value lookup', () => {
    expect(varsMap([{ name: 'a', value: 1 }, { name: 'b', value: 2 }])).toEqual({
      a: 1,
      b: 2,
    });
  });
});

/**
 * Tiny safe arithmetic evaluator for variable-bound numeric fields.
 *
 * Supports number literals, variable identifiers, the binary operators
 * + - * / %, parentheses and unary +/-. Deliberately does NOT use eval/Function
 * so untrusted expressions from a project file can never execute code.
 */

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUM_RE = /\d*\.?\d+(?:[eE][+-]?\d+)?/y;

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if ('+-*/%()'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    NUM_RE.lastIndex = i;
    const num = NUM_RE.exec(src);
    if (num && num.index === i) {
      tokens.push({ t: 'num', v: parseFloat(num[0]) });
      i = NUM_RE.lastIndex;
      continue;
    }
    IDENT_RE.lastIndex = i;
    const id = IDENT_RE.exec(src);
    if (id && id.index === i) {
      tokens.push({ t: 'id', v: id[0] });
      i = IDENT_RE.lastIndex;
      continue;
    }
    return null; // unexpected character
  }
  return tokens;
}

/**
 * Evaluates an expression against a variable map. Returns the numeric result,
 * or null if the expression is malformed or references an unknown variable.
 */
export function evaluateExpr(
  src: string,
  vars: Record<string, number>,
): number | null {
  const tokens = tokenize(src);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  let failed = false;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  // expr := term (('+' | '-') term)*
  // term := factor (('*' | '/' | '%') factor)*
  // factor := ('+' | '-') factor | '(' expr ')' | num | id
  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        eat();
        const right = parseTerm();
        left = tk.v === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/' || tk.v === '%')) {
        eat();
        const right = parseFactor();
        left = tk.v === '*' ? left * right : tk.v === '/' ? left / right : left % right;
      } else break;
    }
    return left;
  }

  function parseFactor(): number {
    const tk = peek();
    if (!tk) {
      failed = true;
      return 0;
    }
    if (tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
      eat();
      const v = parseFactor();
      return tk.v === '-' ? -v : v;
    }
    if (tk.t === 'op' && tk.v === '(') {
      eat();
      const v = parseExpr();
      const close = peek();
      if (close && close.t === 'op' && close.v === ')') eat();
      else failed = true;
      return v;
    }
    if (tk.t === 'num') {
      eat();
      return tk.v;
    }
    if (tk.t === 'id') {
      eat();
      if (Object.prototype.hasOwnProperty.call(vars, tk.v)) return vars[tk.v];
      failed = true;
      return 0;
    }
    failed = true;
    return 0;
  }

  const result = parseExpr();
  if (failed || pos !== tokens.length) return null;
  if (!Number.isFinite(result)) return null;
  return result;
}

/** True when the text is a plain numeric literal (no variables / operators). */
export function isPlainNumber(text: string): boolean {
  return /^\s*[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?\s*$/.test(text);
}

/** Builds a name->value lookup from a variable list. */
export function varsMap(
  variables: { name: string; value: number }[],
): Record<string, number> {
  const m: Record<string, number> = {};
  for (const v of variables) m[v.name] = v.value;
  return m;
}

/** All distinct identifiers (variable names) referenced by an expression. */
export function identifiers(src: string): string[] {
  const tokens = tokenize(src);
  if (!tokens) return [];
  const out = new Set<string>();
  for (const t of tokens) if (t.t === 'id') out.add(t.v);
  return [...out];
}

/** Replaces whole-identifier occurrences of `from` with `to` in an expression. */
export function renameIdentifier(expr: string, from: string, to: string): string {
  if (!from || from === to) return expr;
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return expr.replace(re, to);
}

import { useEffect, useRef, useState } from 'react';
import type { Easing, Vec3 } from '../../state/types';
import {
  getChannelTrack,
  keyframeAtTime,
  useDocumentStore,
} from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { evaluateExpr, isPlainNumber, varsMap } from '../../state/expr';
import styles from './inspector.module.css';

/** Glyph + label per keyframe interpolation mode (null = no keyframe here). */
const KF_MODE: Record<Easing | 'none', { glyph: string; label: string }> = {
  none: { glyph: '◇', label: 'No keyframe (click to add)' },
  linear: { glyph: '◆', label: 'Linear' },
  easeIn: { glyph: '◣', label: 'Ease in' },
  easeOut: { glyph: '◢', label: 'Ease out' },
  easeInOut: { glyph: '⬗', label: 'Ease in-out' },
  step: { glyph: '▣', label: 'Hold / step' },
};

/**
 * Small per-value keyframe toggle. Shows the interpolation mode of the keyframe
 * at the current playhead (or hollow if none); clicking cycles
 * none → linear → easeIn → easeOut → easeInOut → step → none.
 */
export function KeyframeDiamond({ channelKey }: { channelKey: string }) {
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const track = useDocumentStore((s) => getChannelTrack(s.project, channelKey));
  const cycleKeyframe = useDocumentStore((s) => s.cycleKeyframe);

  const kf = keyframeAtTime(track, playheadMs);
  const mode = kf ? kf.interpolation : 'none';
  const animated = (track?.length ?? 0) > 0;
  const info = KF_MODE[mode];

  return (
    <button
      type="button"
      className={`${styles.kfDiamond} ${kf ? styles.kfDiamondOn : ''} ${
        animated && !kf ? styles.kfDiamondTrack : ''
      }`}
      title={`${info.label}${animated ? '' : ''}`}
      onClick={() => cycleKeyframe(channelKey, playheadMs)}
    >
      {info.glyph}
    </button>
  );
}

/** Whether a channel has a keyframe exactly at the current playhead. */
function useKeyedAtPlayhead(channelKey?: string): boolean {
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const track = useDocumentStore((s) =>
    channelKey ? getChannelTrack(s.project, channelKey) : undefined,
  );
  return !!channelKey && !!keyframeAtTime(track, playheadMs);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

// ---- Color conversion (hex <-> HSV) ---------------------------------------
type Hsv = { h: number; s: number; v: number }; // h:0-360, s/v:0-100

function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, v: 0 };
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round((max === 0 ? 0 : d / max) * 100), v: Math.round(max * 100) };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const sN = s / 100;
  const vN = v / 100;
  const c = vN * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mq = vN - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (n: number) =>
    Math.round((n + mq) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** The identifier being typed immediately before the caret (for autocomplete). */
function tokenBeforeCaret(
  text: string,
  caret: number,
): { token: string; start: number } | null {
  const m = text.slice(0, caret).match(/[A-Za-z_][A-Za-z0-9_]*$/);
  return m ? { token: m[0], start: caret - m[0].length } : null;
}

/** A numeric input that commits on blur/Enter and stays in sync otherwise.
 * When `mixed`, the field shows a red MIXED placeholder; typing a value commits.
 * When `bindKey` is given, the field can also hold a variable expression
 * (e.g. `width*2`): it is stored as a live binding and re-evaluated whenever a
 * variable changes, and an autocomplete menu of variable names is shown. */
/** Pluggable expression source so the same field can bind objects or variables. */
export interface BindingAdapter {
  expr: string | undefined;
  commitExpr: (expr: string) => void;
  commitNumber: (n: number) => void;
}

export function NumberField({
  value,
  onCommit,
  suffix,
  axis,
  mixed,
  bindKey,
  binding,
  keyframeKey,
}: {
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
  axis?: 'x' | 'y' | 'z';
  mixed?: boolean;
  bindKey?: string;
  /** Overrides bindKey: a custom expression source (used by variable fields). */
  binding?: BindingAdapter;
  /** When set, shows a per-value keyframe diamond bound to this channel. */
  keyframeKey?: string;
}) {
  const storeExpr = useDocumentStore((s) => (bindKey ? s.project.bindings[bindKey] : undefined));
  const variables = useDocumentStore((s) => s.project.variables);
  const setBinding = useDocumentStore((s) => s.setBinding);
  const clearBinding = useDocumentStore((s) => s.clearBinding);
  const keyedHere = useKeyedAtPlayhead(keyframeKey);

  // Resolve the active binding adapter (explicit prop, or default object/scene binding).
  const adapter: BindingAdapter | undefined =
    binding ??
    (bindKey
      ? {
          expr: storeExpr,
          commitExpr: (e) => setBinding(bindKey, e),
          commitNumber: (n) => {
            if (storeExpr != null) clearBinding(bindKey);
            onCommit(n);
          },
        }
      : undefined);
  const expr = adapter?.expr;
  const bound = expr != null;
  const display = bound ? expr! : mixed ? '' : fmt(value);

  const [text, setText] = useState(display);
  const [caret, setCaret] = useState(0);
  const [acIndex, setAcIndex] = useState(0);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused.current) setText(display);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  // Autocomplete matches for the identifier under the caret (variables + `time`).
  const suggestions: { id: string; name: string; value: number | null }[] = [
    ...variables.map((v) => ({ id: v.id, name: v.name, value: v.value })),
    { id: '__time', name: 'time', value: null },
  ];
  const tok = adapter && focused.current ? tokenBeforeCaret(text, caret) : null;
  const matches =
    tok && tok.token
      ? suggestions
          .filter((v) => v.name.toLowerCase().startsWith(tok.token.toLowerCase()))
          .slice(0, 6)
      : [];
  const acOpen = matches.length > 0;

  const accept = (name: string) => {
    if (!tok) return;
    const next = text.slice(0, tok.start) + name + text.slice(caret);
    setText(next);
    const pos = tok.start + name.length;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.setSelectionRange(pos, pos);
        setCaret(pos);
      }
    });
  };

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      setText(display);
      return;
    }
    if (!adapter || isPlainNumber(t)) {
      const n = parseFloat(t);
      if (!Number.isNaN(n)) {
        if (adapter) adapter.commitNumber(n);
        else onCommit(n);
      } else {
        setText(display);
      }
      return;
    }
    // Expression: store it if it evaluates (allowing the `time` variable).
    const v = evaluateExpr(t, { ...varsMap(variables), time: 0 });
    if (v != null) adapter.commitExpr(t);
    else setText(display);
  };

  return (
    <label
      className={`${styles.numField} ${axis ? styles[`axis-${axis}`] : ''} ${
        bound ? styles.boundField : ''
      } ${keyedHere ? styles.kfActiveField : ''}`}
    >
      {axis && <span className={styles.axisLabel}>{axis.toUpperCase()}</span>}
      <input
        ref={inputRef}
        value={text}
        placeholder={mixed ? 'MIXED' : undefined}
        className={mixed && text === '' ? styles.mixedInput : undefined}
        inputMode={adapter ? 'text' : 'decimal'}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setAcIndex(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          // Let an autocomplete click land before committing.
          setTimeout(commit, 120);
        }}
        onKeyDown={(e) => {
          if (acOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setAcIndex((i) =>
              e.key === 'ArrowDown'
                ? (i + 1) % matches.length
                : (i - 1 + matches.length) % matches.length,
            );
            return;
          }
          if (acOpen && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            accept(matches[acIndex].name);
            return;
          }
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            // Don't let the global Escape shortcut clear the selection too.
            e.stopPropagation();
            setText(display);
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
      {keyframeKey && !bound && <KeyframeDiamond channelKey={keyframeKey} />}
      {acOpen && (
        <div className={styles.acMenu}>
          {matches.map((v, i) => (
            <button
              key={v.id}
              type="button"
              className={`${styles.acItem} ${i === acIndex ? styles.acItemActive : ''}`}
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(v.name);
              }}
            >
              <span>{v.name}</span>
              <span className={styles.acValue}>{v.value == null ? 's' : fmt(v.value)}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

/** Three axis-colored numeric fields for a Vec3. */
export function Vec3Field({
  value,
  onCommit,
  suffix,
  bindKeyBase,
  keyframeKeyBase,
}: {
  value: Vec3;
  onCommit: (v: Vec3) => void;
  suffix?: string;
  /** When set, each axis becomes bindable under `${bindKeyBase}:${axisIndex}`. */
  bindKeyBase?: string;
  /** When set, each axis gets a keyframe diamond under `${keyframeKeyBase}:${axisIndex}`. */
  keyframeKeyBase?: string;
}) {
  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  return (
    <div className={styles.vec3}>
      {axes.map((a, i) => (
        <NumberField
          key={a}
          axis={a}
          suffix={suffix}
          value={value[i]}
          bindKey={bindKeyBase ? `${bindKeyBase}:${i}` : undefined}
          keyframeKey={keyframeKeyBase ? `${keyframeKeyBase}:${i}` : undefined}
          onCommit={(v) => {
            const next = [...value] as Vec3;
            next[i] = v;
            onCommit(next);
          }}
        />
      ))}
    </div>
  );
}

/** A 0..1 slider with a percentage / value readout. Shows MIXED when undefined. */
export function Slider({
  value,
  onChange,
  display,
  mixed,
  keyframeKey,
}: {
  value: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
  mixed?: boolean;
  keyframeKey?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={styles.slider}>
      <input
        className={styles.range}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={mixed ? 0 : value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: mixed
            ? 'var(--panel-3)'
            : `linear-gradient(to right, var(--accent) ${pct}%, var(--panel-3) ${pct}%)`,
        }}
      />
      {keyframeKey && <KeyframeDiamond channelKey={keyframeKey} />}
      <span className={mixed ? styles.mixedLabel : styles.sliderValue}>
        {mixed ? 'MIXED' : display ? display(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

const PALETTE = [
  '#b8c0cc',
  '#e7e9ee',
  '#ef4444',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#4c8bf5',
  '#8b5cf6',
  '#ec4899',
  '#78716c',
  '#1f2937',
];

export function ColorField({
  value,
  onChange,
  mixed,
  keyframeKey,
}: {
  value: string;
  onChange: (v: string) => void;
  mixed?: boolean;
  keyframeKey?: string;
}) {
  return (
    <div className={styles.colorField}>
      {(mixed || keyframeKey) && (
        <div className={styles.colorHead}>
          {mixed && <span className={styles.mixedLabel}>MIXED</span>}
          {keyframeKey && <KeyframeDiamond channelKey={keyframeKey} />}
        </div>
      )}
      <div className={styles.palette}>
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`${styles.swatch} ${
              !mixed && c.toLowerCase() === value.toLowerCase()
                ? styles.swatchActive
                : ''
            }`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
      </div>
      <input
        type="color"
        className={styles.colorPicker}
        value={mixed ? '#888888' : value}
        onChange={(e) => onChange(e.target.value)}
      />
      <HsvInputs value={mixed ? '#888888' : value} mixed={mixed} onChange={onChange} />
    </div>
  );
}

/** H/S/V + hex numeric readout/editors, synced with the hex `value`. */
function HsvInputs({
  value,
  onChange,
  mixed,
}: {
  value: string;
  onChange: (v: string) => void;
  mixed?: boolean;
}) {
  const hsv = hexToHsv(value);
  const [hex, setHex] = useState(value);
  const hexFocused = useRef(false);
  useEffect(() => {
    if (!hexFocused.current) setHex(value);
  }, [value]);

  const setChannel = (patch: Partial<Hsv>) => onChange(hsvToHex({ ...hsv, ...patch }));

  const channel = (
    label: string,
    key: keyof Hsv,
    max: number,
  ) => (
    <label className={styles.hsvField}>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={mixed ? '' : hsv[key]}
        onChange={(e) => {
          const n = Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0)));
          setChannel({ [key]: n } as Partial<Hsv>);
        }}
      />
    </label>
  );

  const commitHex = () => {
    if (/^#?[0-9a-fA-F]{6}$/.test(hex.trim())) {
      onChange(hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`);
    } else {
      setHex(value);
    }
  };

  return (
    <div className={styles.hsvRow}>
      {channel('H', 'h', 360)}
      {channel('S', 's', 100)}
      {channel('V', 'v', 100)}
      <label className={`${styles.hsvField} ${styles.hexField}`}>
        <span>#</span>
        <input
          value={mixed ? '' : hex.replace(/^#/, '')}
          spellCheck={false}
          onFocus={() => (hexFocused.current = true)}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => {
            hexFocused.current = false;
            commitHex();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </label>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>{label}</div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span>{title}</span>
        {right}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

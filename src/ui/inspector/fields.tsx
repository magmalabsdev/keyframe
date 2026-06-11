import { useEffect, useRef, useState } from 'react';
import type { Vec3 } from '../../state/types';
import styles from './inspector.module.css';

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** A numeric input that commits on blur/Enter and stays in sync otherwise. */
export function NumberField({
  value,
  onCommit,
  suffix,
  axis,
}: {
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
  axis?: 'x' | 'y' | 'z';
}) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    const n = parseFloat(text);
    if (!Number.isNaN(n)) onCommit(n);
    else setText(fmt(value));
  };

  return (
    <label className={`${styles.numField} ${axis ? styles[`axis-${axis}`] : ''}`}>
      {axis && <span className={styles.axisLabel}>{axis.toUpperCase()}</span>}
      <input
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </label>
  );
}

/** Three axis-colored numeric fields for a Vec3. */
export function Vec3Field({
  value,
  onCommit,
  suffix,
}: {
  value: Vec3;
  onCommit: (v: Vec3) => void;
  suffix?: string;
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

/** A 0..1 slider with a percentage / value readout. */
export function Slider({
  value,
  onChange,
  display,
}: {
  value: number;
  onChange: (v: number) => void;
  display?: (v: number) => string;
}) {
  return (
    <div className={styles.slider}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className={styles.sliderValue}>
        {display ? display(value) : value.toFixed(2)}
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
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={styles.colorField}>
      <div className={styles.palette}>
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`${styles.swatch} ${
              c.toLowerCase() === value.toLowerCase() ? styles.swatchActive : ''
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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

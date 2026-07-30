import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '../../state/documentStore';
import {
  BUNDLED_FONT_LABEL,
  importFontFile,
  importSystemFont,
  listSystemFonts,
  supportsLocalFonts,
  type SystemFontEntry,
} from '../../io/fonts';
import styles from './inspector.module.css';

const ADD_SYSTEM = '__add-system__';
const UPLOAD = '__upload__';
const BACK = '__back__';

interface Item {
  value: string;
  label: string;
  /** Command rows (Browse system fonts…, Upload…, ← Back) vs. actual fonts. */
  action?: boolean;
}

/**
 * Font selector shared by 3D text and text surfaces. Lists the bundled font
 * plus fonts already embedded in the project; "Browse system fonts…"
 * enumerates installed fonts via the Local Font Access API (Chromium; the
 * triggering click is the required user gesture) and "Upload font file…" is
 * the everywhere-else path. Picking either copies the font's bytes into the
 * project so exports stay self-contained.
 *
 * A searchable list, not a native <select>: system font lists can run into the
 * hundreds, where a select's built-in "type to jump" behavior (which only
 * matches from the start of the label and forgets what you typed after a
 * pause) is painful. This filters as you type instead.
 */
export function FontPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (fontId: string | undefined) => void;
}) {
  const media = useDocumentStore((s) => s.project.media);
  const fontAssets = Object.values(media).filter((m) => m.kind === 'font');
  const missing = value != null && !media[value];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'browse' | 'system'>('browse');
  const [systemFonts, setSystemFonts] = useState<SystemFontEntry[] | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const currentLabel = missing
    ? 'Missing font (using Inter)'
    : value != null
      ? (media[value]?.name ?? BUNDLED_FONT_LABEL)
      : BUNDLED_FONT_LABEL;

  const q = query.toLowerCase();
  const items: Item[] =
    mode === 'system'
      ? [
          { value: BACK, label: '← Back', action: true },
          ...(systemFonts ?? [])
            .filter((f) => f.family.toLowerCase().includes(q))
            .map((f) => ({ value: f.postscriptName, label: f.family })),
        ]
      : [
          { value: '', label: BUNDLED_FONT_LABEL },
          ...fontAssets.map((f) => ({ value: f.id, label: f.name })),
        ].filter((it) => it.label.toLowerCase().includes(q));

  // Command rows stay visible regardless of the filter — they're actions, not
  // data to search — and are appended after the (possibly filtered) fonts.
  const actionItems: Item[] =
    mode === 'browse'
      ? [
          ...(supportsLocalFonts() ? [{ value: ADD_SYSTEM, label: 'Browse system fonts…', action: true }] : []),
          { value: UPLOAD, label: 'Upload font file…', action: true },
        ]
      : [];

  const visible: Item[] = mode === 'system' ? items : [...items, ...actionItems];

  const openMenu = () => {
    setOpen(true);
    setQuery('');
    setMode('browse');
    setError(null);
    setHighlight(0);
  };

  const closeMenu = () => setOpen(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const selectItem = (item: Item) => {
    if (item.value === BACK) {
      setMode('browse');
      setQuery('');
      setHighlight(0);
      return;
    }
    if (item.value === ADD_SYSTEM) {
      // Called synchronously from the click/Enter handler: queryLocalFonts
      // needs a user gesture.
      listSystemFonts()
        .then((fonts) => {
          setSystemFonts(fonts);
          setMode('system');
          setQuery('');
          setHighlight(0);
        })
        .catch(() => {
          setError('Font access was denied.');
          closeMenu();
        });
      return;
    }
    if (item.value === UPLOAD) {
      fileInput.current?.click();
      closeMenu();
      return;
    }
    if (mode === 'system') {
      const entry = systemFonts?.find((f) => f.postscriptName === item.value);
      if (!entry) return;
      closeMenu();
      importSystemFont(entry)
        .then(onChange)
        .catch(() => setError('Could not load that font.'));
      return;
    }
    onChange(item.value === '' ? undefined : item.value);
    closeMenu();
  };

  return (
    <div className={styles.fontPicker} ref={rootRef}>
      <button
        type="button"
        className={styles.fullSelect}
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        {currentLabel}
      </button>
      {open && (
        <div className={styles.fontMenu}>
          <input
            ref={inputRef}
            className={styles.fontSearch}
            placeholder={mode === 'system' ? 'Search system fonts…' : 'Search fonts…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => Math.min(visible.length - 1, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (visible[highlight]) selectItem(visible[highlight]);
              } else if (e.key === 'Escape') {
                e.stopPropagation(); // don't also clear the object selection
                closeMenu();
              }
            }}
          />
          <div className={styles.fontList}>
            {visible.length === 0 && <div className={styles.fontEmpty}>No fonts found</div>}
            {visible.map((item, i) => (
              <button
                key={item.value}
                type="button"
                className={`${styles.fontItem} ${i === highlight ? styles.fontItemActive : ''} ${
                  item.action ? styles.fontItemAction : ''
                }`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => selectItem(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <div className={styles.hint}>{error}</div>}
      <input
        ref={fileInput}
        type="file"
        accept=".ttf,.otf,.woff"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFontFile(file).then(onChange);
          e.target.value = '';
        }}
      />
    </div>
  );
}

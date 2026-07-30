import { useEditorStore, type Tool } from '../state/editorStore';
import styles from './ViewportToolbar.module.css';

const TOOLS: { tool: Tool; label: string; glyph: string; key: string }[] = [
  { tool: 'select', label: 'Select', glyph: '⤢', key: '1' },
  { tool: 'move', label: 'Move', glyph: '✛', key: '2' },
  { tool: 'scale', label: 'Scale', glyph: '⤡', key: '3' },
  { tool: 'rotate', label: 'Rotate', glyph: '↻', key: '4' },
  { tool: 'place', label: 'Place', glyph: '⊥', key: '5' },
  { tool: 'surface', label: 'Surface', glyph: '▣', key: '6' },
];

export function ViewportToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);

  return (
    <div className={styles.toolbar}>
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`${styles.tool} ${activeTool === t.tool ? styles.active : ''}`}
          onClick={() => setTool(t.tool)}
          title={
            t.tool === 'place'
              ? 'Place on face — click a face to lay it on the plate (5)'
              : t.tool === 'surface'
                ? 'Surface on face — click a face to add text or an image to it (6)'
                : `${t.label} (${t.key})`
          }
        >
          <span className={styles.glyph}>{t.glyph}</span>
          <span className={styles.label}>{t.label}</span>
        </button>
      ))}
      <button
        className={`${styles.tool} ${styles.snap} ${snapEnabled ? styles.active : ''}`}
        onClick={() => setSnapEnabled(!snapEnabled)}
        title="Toggle object snapping while moving"
      >
        <span className={styles.glyph}>⊞</span>
        <span className={styles.label}>Snap</span>
      </button>
    </div>
  );
}

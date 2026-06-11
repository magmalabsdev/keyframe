import { useEditorStore, type Tool } from '../state/editorStore';
import styles from './ViewportToolbar.module.css';

const TOOLS: { tool: Tool; label: string; glyph: string; key: string }[] = [
  { tool: 'select', label: 'Select', glyph: '⤢', key: '1' },
  { tool: 'move', label: 'Move', glyph: '✛', key: '2' },
  { tool: 'scale', label: 'Scale', glyph: '⤡', key: '3' },
  { tool: 'rotate', label: 'Rotate', glyph: '↻', key: '4' },
];

export function ViewportToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);

  return (
    <div className={styles.toolbar}>
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`${styles.tool} ${activeTool === t.tool ? styles.active : ''}`}
          onClick={() => setTool(t.tool)}
          title={`${t.label} (${t.key})`}
        >
          <span className={styles.glyph}>{t.glyph}</span>
          <span className={styles.label}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

import { useEditorStore } from '../state/editorStore';
import { chordLabel, KEYMAP, type ShortcutGroup } from '../app/keymap';
import styles from './ShortcutHelp.module.css';

/** Order groups are presented in; anything unlisted falls to the end. */
const GROUP_ORDER: ShortcutGroup[] = [
  'Playback',
  'Navigation',
  'Marks',
  'Markers',
  'Keyframes',
  'Edit',
  'Tools',
  'General',
];

/**
 * The keyboard cheat sheet, generated from the same KEYMAP the dispatcher
 * binds — so it can never list a shortcut that doesn't work, or miss one.
 */
export function ShortcutHelp() {
  const open = useEditorStore((s) => s.helpOpen);
  const setHelpOpen = useEditorStore((s) => s.setHelpOpen);
  if (!open) return null;

  // Conditional bindings (mark-clip with no selection, go-to-in with no in
  // point) are hidden rather than shown as dead keys.
  const visible = KEYMAP.filter((b) => !b.hidden && (!b.when || b.when()));
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    items: visible.filter((b) => b.group === g),
  })).filter((g) => g.items.length > 0);

  return (
    <div className={styles.backdrop} onPointerDown={() => setHelpOpen(false)}>
      <div className={styles.panel} onPointerDown={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span>Keyboard shortcuts</span>
          <button onClick={() => setHelpOpen(false)} title="Close (Esc)">
            ×
          </button>
        </div>
        <div className={styles.columns}>
          {groups.map(({ group, items }) => (
            <section key={group} className={styles.group}>
              <h3>{group}</h3>
              {items.map((b) => (
                <div key={b.id} className={styles.row}>
                  <kbd>{chordLabel(b)}</kbd>
                  <span>{b.label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

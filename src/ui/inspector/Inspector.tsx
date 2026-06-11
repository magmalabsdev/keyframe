import { useActiveScene } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { ObjectInspector } from './ObjectInspector';
import { SceneInspector } from './SceneInspector';
import styles from './inspector.module.css';

export function Inspector() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const objects = useActiveScene().objects;

  if (selectedIds.length === 1) {
    const obj = objects.find((o) => o.id === selectedIds[0]);
    if (obj) return <ObjectInspector object={obj} />;
  }

  if (selectedIds.length > 1) {
    return (
      <div className={styles.inspector}>
        <div className={styles.empty}>
          <p className={styles.hint}>
            {selectedIds.length} objects selected. Grouping and multi-edit are
            coming soon — select a single object to edit it.
          </p>
        </div>
      </div>
    );
  }

  return <SceneInspector />;
}

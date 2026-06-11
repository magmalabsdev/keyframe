import { useRef, useState } from 'react';
import { useDocumentStore, useActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { importModelFiles } from '../io/importModel';
import { SUPPORTED_EXTENSIONS } from '../io/loaders';
import styles from './LeftBar.module.css';

const ACCEPT = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',');

export function LeftBar() {
  const scenes = useDocumentStore((s) => s.project.scenes);
  const activeScene = useActiveScene();
  const setActiveScene = useDocumentStore((s) => s.setActiveScene);
  const setObjectVisible = useDocumentStore((s) => s.setObjectVisible);
  const removeObjects = useDocumentStore((s) => s.removeObjects);

  const selectedIds = useEditorStore((s) => s.selectedIds);
  const toggleSelection = useEditorStore((s) => s.toggleSelection);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const { errors } = await importModelFiles(files);
    setBusy(false);
    if (errors.length) alert('Some files failed to import:\n' + errors.join('\n'));
  }

  return (
    <div className={styles.bar}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>Scenes</div>
        <select
          className={styles.sceneSelect}
          value={activeScene.id}
          onChange={(e) => setActiveScene(e.target.value)}
        >
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
        </select>
      </section>

      <section className={`${styles.section} ${styles.grow}`}>
        <div className={styles.sectionHead}>
          <span>Objects</span>
          <button
            className={styles.importBtn}
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            title="Import STL, OBJ, glTF/GLB, or STEP"
          >
            {busy ? 'Importing…' : '+ Import'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        <div className={styles.objectList}>
          {activeScene.objects.length === 0 ? (
            <div className={styles.empty}>
              No objects yet.
              <br />
              Import or drag in an STL, OBJ, glTF, or STEP file.
            </div>
          ) : (
            activeScene.objects.map((obj) => {
              const isSelected = selectedIds.includes(obj.id);
              return (
                <div
                  key={obj.id}
                  className={`${styles.objectRow} ${
                    isSelected ? styles.selected : ''
                  }`}
                  onPointerDown={(e) => toggleSelection(obj.id, e.shiftKey)}
                >
                  <button
                    className={styles.eye}
                    title={obj.visible ? 'Hide' : 'Show'}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setObjectVisible(obj.id, !obj.visible);
                    }}
                  >
                    {obj.visible ? '◉' : '○'}
                  </button>
                  <span className={styles.objectName}>{obj.name}</span>
                  <button
                    className={styles.delete}
                    title="Delete"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      removeObjects([obj.id]);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

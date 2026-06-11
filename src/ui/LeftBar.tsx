import { useRef, useState } from 'react';
import { useDocumentStore, useActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { importModelFiles } from '../io/importModel';
import { SUPPORTED_EXTENSIONS } from '../io/loaders';
import { childrenOf } from '../scene/tree';
import { groupSelection, ungroupSelection } from '../scene/grouping';
import type { SceneObject } from '../state/types';
import styles from './LeftBar.module.css';

const ACCEPT = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',');

function ObjectRow({
  obj,
  objects,
  depth,
}: {
  obj: SceneObject;
  objects: SceneObject[];
  depth: number;
}) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const toggleSelection = useEditorStore((s) => s.toggleSelection);
  const setObjectVisible = useDocumentStore((s) => s.setObjectVisible);
  const removeObjects = useDocumentStore((s) => s.removeObjects);
  const [open, setOpen] = useState(true);

  const isSelected = selectedIds.includes(obj.id);
  const kids = obj.type === 'group' ? childrenOf(objects, obj.id) : [];

  return (
    <>
      <div
        className={`${styles.objectRow} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onPointerDown={(e) => toggleSelection(obj.id, e.shiftKey)}
      >
        {obj.type === 'group' ? (
          <button
            className={styles.disclosure}
            onPointerDown={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className={styles.disclosure} />
        )}
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
        <span className={styles.objectName}>
          {obj.type === 'group' ? '▦ ' : ''}
          {obj.name}
        </span>
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
      {obj.type === 'group' &&
        open &&
        kids.map((c) => (
          <ObjectRow key={c.id} obj={c} objects={objects} depth={depth + 1} />
        ))}
    </>
  );
}

export function LeftBar() {
  const scenes = useDocumentStore((s) => s.project.scenes);
  const activeScene = useActiveScene();
  const setActiveScene = useDocumentStore((s) => s.setActiveScene);
  const selectedIds = useEditorStore((s) => s.selectedIds);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const objects = activeScene.objects;
  const roots = objects.filter((o) => !o.parentId);
  const selectedObjects = objects.filter((o) => selectedIds.includes(o.id));
  const canGroup = selectedObjects.length >= 2;
  const canUngroup = selectedObjects.some((o) => o.type === 'group');

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
          <div className={styles.headActions}>
            {canUngroup && (
              <button className={styles.importBtn} onClick={ungroupSelection} title="Ungroup (⌘⇧G)">
                Ungroup
              </button>
            )}
            {canGroup && (
              <button className={styles.importBtn} onClick={groupSelection} title="Group (⌘G)">
                Group
              </button>
            )}
            <button
              className={styles.importBtn}
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              title="Import STL, OBJ, glTF/GLB, or STEP"
            >
              {busy ? 'Importing…' : '+ Import'}
            </button>
          </div>
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
          {objects.length === 0 ? (
            <div className={styles.empty}>
              No objects yet.
              <br />
              Import or drag in an STL, OBJ, glTF, or STEP file.
            </div>
          ) : (
            roots.map((obj) => (
              <ObjectRow key={obj.id} obj={obj} objects={objects} depth={0} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

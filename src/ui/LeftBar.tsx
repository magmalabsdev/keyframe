import { useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useDocumentStore, useActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { importModelFiles } from '../io/importModel';
import { SUPPORTED_EXTENSIONS } from '../io/loaders';
import { childrenOf, flattenTree } from '../scene/tree';
import { groupSelection, ungroupSelection } from '../scene/grouping';
import { openSelectionMenu } from './ContextMenu';
import type { SceneObject } from '../state/types';
import styles from './LeftBar.module.css';

const ACCEPT = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',');

function ObjectRow({
  obj,
  objects,
  depth,
  onSelectRow,
  onContextMenuRow,
}: {
  obj: SceneObject;
  objects: SceneObject[];
  depth: number;
  onSelectRow: (id: string, e: ReactPointerEvent) => void;
  onContextMenuRow: (id: string, e: ReactMouseEvent) => void;
}) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
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
        onPointerDown={(e) => onSelectRow(obj.id, e)}
        onContextMenu={(e) => onContextMenuRow(obj.id, e)}
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
          <ObjectRow
            key={c.id}
            obj={c}
            objects={objects}
            depth={depth + 1}
            onSelectRow={onSelectRow}
            onContextMenuRow={onContextMenuRow}
          />
        ))}
    </>
  );
}

export function LeftBar() {
  const scenes = useDocumentStore((s) => s.project.scenes);
  const activeScene = useActiveScene();
  const setActiveScene = useDocumentStore((s) => s.setActiveScene);
  const addScene = useDocumentStore((s) => s.addScene);
  const removeScene = useDocumentStore((s) => s.removeScene);
  const renameScene = useDocumentStore((s) => s.renameScene);
  const duplicateScene = useDocumentStore((s) => s.duplicateScene);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setSelection = useEditorStore((s) => s.setSelection);
  const toggleSelection = useEditorStore((s) => s.toggleSelection);
  const importQuality = useEditorStore((s) => s.importQuality);
  const setImportQuality = useEditorStore((s) => s.setImportQuality);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const anchorIdRef = useRef<string | null>(null);

  const objects = activeScene.objects;
  const roots = objects.filter((o) => !o.parentId);
  const selectedObjects = objects.filter((o) => selectedIds.includes(o.id));
  const canGroup = selectedObjects.length >= 2;
  const canUngroup = selectedObjects.some((o) => o.type === 'group');

  const onContextMenuRow = (id: string, e: ReactMouseEvent) => {
    e.preventDefault();
    if (!selectedIds.includes(id)) setSelection([id]);
    openSelectionMenu(e.clientX, e.clientY);
  };

  const onSelectRow = (id: string, e: ReactPointerEvent) => {
    if (e.metaKey || e.ctrlKey) {
      toggleSelection(id, true);
      anchorIdRef.current = id;
    } else if (e.shiftKey) {
      const order = flattenTree(objects);
      const anchorId = anchorIdRef.current ?? id;
      const fromIdx = order.findIndex((o) => o.id === anchorId);
      const toIdx = order.findIndex((o) => o.id === id);
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      setSelection(order.slice(lo, hi + 1).map((o) => o.id));
    } else {
      setSelection([id]);
      anchorIdRef.current = id;
    }
  };

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
        <div className={styles.sectionHead}>
          <span>Scenes</span>
          <div className={styles.headActions}>
            <button className={styles.importBtn} onClick={duplicateScene} title="Duplicate scene">
              Duplicate
            </button>
            <button className={styles.importBtn} onClick={addScene} title="New scene">
              + Scene
            </button>
          </div>
        </div>
        <div className={styles.sceneList}>
          {scenes.map((scene) => (
            <div
              key={scene.id}
              className={`${styles.sceneRow} ${
                scene.id === activeScene.id ? styles.selected : ''
              }`}
              onPointerDown={() => setActiveScene(scene.id)}
              onDoubleClick={() => {
                const name = prompt('Rename scene', scene.name);
                if (name) renameScene(scene.id, name);
              }}
            >
              <span className={styles.objectName}>{scene.name}</span>
              {scenes.length > 1 && (
                <button
                  className={styles.delete}
                  title="Delete scene"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${scene.name}"?`)) removeScene(scene.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
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
        <div
          className={styles.qualityRow}
          title="STEP import quality: higher = smoother curves but more triangles (slower)"
        >
          <span>STEP quality</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={importQuality}
            onChange={(e) => setImportQuality(Number(e.target.value))}
          />
          <span className={styles.qualityValue}>{Math.round(importQuality * 100)}%</span>
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
              <ObjectRow
                key={obj.id}
                obj={obj}
                objects={objects}
                depth={0}
                onSelectRow={onSelectRow}
                onContextMenuRow={onContextMenuRow}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

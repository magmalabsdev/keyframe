import { useRef } from 'react';
import { useDocumentStore, undo, redo, useTemporal } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import {
  exportActiveScene,
  exportProject,
  openProjectFile,
} from '../io/persistence';
import { startRender, hasRendered, isModifiedSinceRender, markRendered } from '../render/renderState';
import { exportVideo, isVideoExportSupported } from '../render/videoExport';
import styles from './TopBar.module.css';

export function TopBar() {
  const name = useDocumentStore((s) => s.project.name);
  const setProjectName = useDocumentStore((s) => s.setProjectName);
  const canUndo = useTemporal((s) => s.pastStates.length > 0);
  const canRedo = useTemporal((s) => s.futureStates.length > 0);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const exporting = useEditorStore((s) => s.exportProgress != null);
  const openInput = useRef<HTMLInputElement>(null);

  async function handleExportVideo() {
    if (!isVideoExportSupported()) {
      alert('Video export needs a browser with WebCodecs support (Chrome or Edge).');
      return;
    }
    if (hasRendered() && isModifiedSinceRender()) {
      if (!confirm('The scene was modified since the last render. Export the current state?')) {
        return;
      }
    }
    const editor = useEditorStore.getState();
    editor.setPlaying(false);
    editor.setExportProgress(0);
    try {
      await exportVideo({ onProgress: (p) => editor.setExportProgress(p) });
      markRendered();
    } catch (err) {
      alert('Video export failed: ' + (err as Error).message);
    } finally {
      editor.setExportProgress(null);
    }
  }

  return (
    <div className={styles.bar}>
      <div className={styles.brand}>
        <img src="/logo.svg" alt="keyframe" className={styles.logo} />
        <span className={styles.appName}>keyframe</span>
      </div>

      <input
        className={styles.projectName}
        value={name}
        onChange={(e) => setProjectName(e.target.value)}
        spellCheck={false}
        aria-label="Project name"
      />

      {saveStatus !== 'idle' && (
        <span className={styles.saveStatus}>
          {saveStatus === 'saving' ? 'Saving…' : 'Saved ✓'}
        </span>
      )}

      <div className={styles.undoRedo}>
        <button onClick={() => undo()} disabled={!canUndo} title="Undo (⌘Z)">
          ↶
        </button>
        <button onClick={() => redo()} disabled={!canRedo} title="Redo (⌘⇧Z)">
          ↷
        </button>
      </div>

      <div className={styles.spacer} />

      <div className={styles.actions}>
        <button
          className="primary"
          onClick={startRender}
          title="Play the entire scene animation from the start"
        >
          ▶ Render
        </button>
        <button
          onClick={handleExportVideo}
          disabled={exporting}
          title="Export an mp4 video of the scene animation"
        >
          {exporting ? 'Exporting…' : 'Export video'}
        </button>
        <button onClick={() => openInput.current?.click()} title="Open a .kfp / .kfpx file">
          Open
        </button>
        <button onClick={exportActiveScene} title="Export the current scene (.kfp)">
          Export .kfp
        </button>
        <button onClick={exportProject} title="Export all scenes (.kfpx)">
          Export .kfpx
        </button>
        <input
          ref={openInput}
          type="file"
          accept=".kfp,.kfpx"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openProjectFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

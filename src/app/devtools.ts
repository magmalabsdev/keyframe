import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import {
  addKeyframeAtPlayhead,
  applyTransformEdit,
} from '../animation/transformEdit';
import { restoreAutosave, saveNow } from '../io/persistence';
import { getCameraState } from '../viewport/cameraApi';
import { getR3F } from '../render/renderApi';
import { groupSelection, ungroupSelection } from '../scene/grouping';

/**
 * Dev-only hooks exposed on window.__kf for automated verification scripts.
 * Not included in production builds (guarded by import.meta.env.DEV).
 */
export function installDevtools(): void {
  (window as unknown as { __kf: unknown }).__kf = {
    doc: useDocumentStore,
    editor: useEditorStore,
    getActiveScene: () => getActiveScene(useDocumentStore.getState().project),
    firstObjectId: () =>
      getActiveScene(useDocumentStore.getState().project).objects[0]?.id,
    applyTransformEdit,
    addKeyframeAtPlayhead,
    saveNow,
    restoreAutosave,
    getCameraState,
    getR3F,
    groupSelection,
    ungroupSelection,
  };
}

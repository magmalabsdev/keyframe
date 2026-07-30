import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { applyTransformEdit, keyframeSelection } from '../animation/transformEdit';
import { restoreAutosave, saveNow } from '../io/persistence';
import { getCameraState, getControls } from '../viewport/cameraApi';
import { getR3F } from '../render/renderApi';
import { groupSelection, ungroupSelection } from '../scene/grouping';
import { placeObjectFaceDown } from '../scene/placeOnFace';
import { trySnap } from '../scene/snapping';
import { commitCenterOfRotation } from '../viewport/PivotHandle';
import { poseObjectAtTime } from '../animation/pose';

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
    keyframeSelection,
    saveNow,
    restoreAutosave,
    getCameraState,
    getControls,
    getR3F,
    groupSelection,
    ungroupSelection,
    placeObjectFaceDown,
    trySnap,
    commitCenterOfRotation,
    poseObjectAtTime,
  };
}

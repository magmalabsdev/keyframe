import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { useEditorStore } from '../state/editorStore';
import { useDocumentStore } from '../state/documentStore';
import { importModelFiles } from '../io/importModel';
import { getR3F } from '../render/renderApi';
import { selectInScene } from '../scene/grouping';
import { openSelectionMenu } from '../ui/ContextMenu';
import { BuildPlate } from './BuildPlate';
import { CameraRig } from './CameraRig';
import { SceneObjects } from './SceneObjects';
import { Gizmo } from './Gizmo';
import { AnimationSystem } from './AnimationSystem';
import { PivotHandle } from './PivotHandle';
import { FaceHighlight } from './FaceHighlight';
import { SceneBackground } from './SceneBackground';
import { SceneAmbient } from './SceneAmbient';
import { SurfaceHandles } from './SurfaceHandles';
import { SurfaceMediaTicker } from './SurfaceMediaTicker';
import { ViewCube } from './ViewCube';
import { registerCamera, clipPlanesFor } from './cameraApi';
import { useMarquee } from './useMarquee';
import { RenderRegistrar } from '../render/RenderRegistrar';
import { ViewportToolbar } from '../ui/ViewportToolbar';
import styles from './Viewport.module.css';

/**
 * With `frameloop="demand"` the scene only redraws when invalidated. Request a
 * frame on any document/editor change and on canvas pointer/wheel input so
 * edits, selection, scrubbing, hover highlights, gizmo drags and orbit all
 * render — while a truly idle viewport costs nothing.
 */
function FrameInvalidation() {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const inv = () => invalidate();
    const unsubDoc = useDocumentStore.subscribe(inv);
    const unsubEditor = useEditorStore.subscribe(inv);
    const el = gl.domElement;
    el.addEventListener('pointermove', inv);
    el.addEventListener('pointerdown', inv);
    el.addEventListener('wheel', inv, { passive: true });
    return () => {
      unsubDoc();
      unsubEditor();
      el.removeEventListener('pointermove', inv);
      el.removeEventListener('pointerdown', inv);
      el.removeEventListener('wheel', inv);
    };
  }, [invalidate, gl]);
  return null;
}

/** Picks the scene-object id of the mesh under a screen point, if any. */
function pickObjectId(clientX: number, clientY: number): string | null {
  const root = getR3F();
  if (!root) return null;
  const r = root.gl.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - r.left) / r.width) * 2 - 1,
    -((clientY - r.top) / r.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, root.camera);
  const hit = ray
    .intersectObjects(root.scene.children, true)
    .find((h) => h.object.visible && h.object.name?.endsWith('__mesh'));
  return hit ? hit.object.name.replace(/__mesh$/, '') : null;
}

export function Viewport() {
  const exportProgress = useEditorStore((s) => s.exportProgress);
  const renderPreview = useEditorStore((s) => s.renderPreview);
  const backgroundTasks = useEditorStore((s) => s.backgroundTasks);
  const [dragOver, setDragOver] = useState(false);
  const marquee = useMarquee();

  return (
    <div
      className={styles.viewport}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void importModelFiles(e.dataTransfer.files);
      }}
      onPointerDown={(e) => {
        if (e.button !== 2 || renderPreview) return;
        // Decide the menu on pointer-UP based on whether an orbit drag happened.
        // contextmenu fires on mouse-DOWN (mac/Linux) before any movement, so it
        // can't tell click from drag; window capture listeners see moves even
        // while camera-controls holds pointer capture during an orbit.
        const sx = e.clientX;
        const sy = e.clientY;
        let moved = false;
        const onMove = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) moved = true;
        };
        const onUp = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', onMove, true);
          window.removeEventListener('pointerup', onUp, true);
          if (ev.button !== 2 || moved) return; // an orbit drag, not a click
          const id = pickObjectId(ev.clientX, ev.clientY);
          if (id && !useEditorStore.getState().selectedIds.includes(id)) {
            selectInScene(id, false);
          }
          openSelectionMenu(ev.clientX, ev.clientY);
        };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The camera's near/far are only starting values — CameraRig re-derives
          them from the camera distance whenever it moves meaningfully. */}
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 45, ...clipPlanesFor(1200), position: [0, 0, 1200] }}
        onCreated={({ camera }) => {
          // Z-up world: build plate lies on the XY plane, camera looks down -Z.
          camera.up.set(0, 0, 1);
          camera.position.set(0, 0, 1200);
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          registerCamera(camera);
        }}
      >
        <FrameInvalidation />
        <SceneBackground />

        {/* The only built-in lighting is the scene's ambient fill (adjustable,
            0 by choice); everything else comes from light objects and emitter
            meshes (see SceneObjects LightRig). */}
        <SceneAmbient />

        <BuildPlate />
        <SceneObjects />
        <Gizmo />
        <PivotHandle />
        <SurfaceHandles />
        <AnimationSystem />
        <FaceHighlight />
        <SurfaceMediaTicker />
        <RenderRegistrar />
        <CameraRig />
      </Canvas>

      {!renderPreview && (
        <>
          <ViewCube />
          <ViewportToolbar />
        </>
      )}

      {marquee.rect && (
        <div
          className={styles.marquee}
          style={{
            left: marquee.rect.x,
            top: marquee.rect.y,
            width: marquee.rect.w,
            height: marquee.rect.h,
          }}
        />
      )}

      {dragOver && (
        <div className={styles.dropOverlay}>Drop model files to import</div>
      )}

      {exportProgress != null && (
        <div className={styles.exportOverlay}>
          <div className={styles.exportCard}>
            <div className={styles.exportTitle}>Exporting video…</div>
            <div className={styles.exportBarTrack}>
              <div
                className={styles.exportBarFill}
                style={{ width: `${Math.round(exportProgress * 100)}%` }}
              />
            </div>
            <div className={styles.exportPct}>
              {Math.round(exportProgress * 100)}%
            </div>
          </div>
        </div>
      )}

      {backgroundTasks.length > 0 && (
        <div className={styles.taskHud}>
          <span>{backgroundTasks[0].label}</span>
          {backgroundTasks[0].progress != null ? (
            <>
              <div className={styles.taskBarTrack}>
                <div
                  className={styles.taskBarFill}
                  style={{ width: `${Math.round(backgroundTasks[0].progress * 100)}%` }}
                />
              </div>
              <span className={styles.taskPct}>
                {Math.round(backgroundTasks[0].progress * 100)}%
              </span>
            </>
          ) : (
            <span className={styles.taskSpinner} />
          )}
        </div>
      )}

      {renderPreview ? (
        <div className={styles.renderHud}>
          <span>● Rendering — press Space to stop</span>
        </div>
      ) : (
        <div className={styles.hud}>
          <span>RMB orbit · MMB / WASD-EQ pan · wheel / +- zoom</span>
        </div>
      )}
    </div>
  );
}

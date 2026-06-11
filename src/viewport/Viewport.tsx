import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { importModelFiles } from '../io/importModel';
import { BuildPlate } from './BuildPlate';
import { CameraRig } from './CameraRig';
import { SceneObjects } from './SceneObjects';
import { Gizmo } from './Gizmo';
import { AnimationSystem } from './AnimationSystem';
import { PivotHandle } from './PivotHandle';
import { ViewCube } from './ViewCube';
import { registerCamera } from './cameraApi';
import { useMarquee } from './useMarquee';
import { RenderRegistrar } from '../render/RenderRegistrar';
import { ViewportToolbar } from '../ui/ViewportToolbar';
import styles from './Viewport.module.css';

export function Viewport() {
  const scene = useActiveScene();
  const exportProgress = useEditorStore((s) => s.exportProgress);
  const renderPreview = useEditorStore((s) => s.renderPreview);
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
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 45, near: 1, far: 500000, position: [0, 0, 1200] }}
        onCreated={({ camera }) => {
          // Z-up world: build plate lies on the XY plane, camera looks down -Z.
          camera.up.set(0, 0, 1);
          camera.position.set(0, 0, 1200);
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          registerCamera(camera);
        }}
      >
        <color attach="background" args={[scene.settings.backgroundColor]} />

        <hemisphereLight args={['#ffffff', '#3a3f4a', 0.6]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[600, -400, 1200]} intensity={1.1} />
        <directionalLight position={[-500, 600, 400]} intensity={0.35} />

        <BuildPlate />
        <SceneObjects />
        <Gizmo />
        <PivotHandle />
        <AnimationSystem />
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

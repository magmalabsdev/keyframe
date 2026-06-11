import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { applyCameraState, getCameraState } from '../../viewport/cameraApi';
import { NumberField, Row, Section } from './fields';
import styles from './inspector.module.css';

export function SceneInspector() {
  const scene = useActiveScene();
  const setSceneName = useDocumentStore((s) => s.setSceneName);
  const setSceneDuration = useDocumentStore((s) => s.setSceneDuration);
  const patchSettings = useDocumentStore((s) => s.patchSceneSettings);
  const upsertCameraKeyframe = useDocumentStore((s) => s.upsertCameraKeyframe);
  const removeCameraKeyframe = useDocumentStore((s) => s.removeCameraKeyframe);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);

  const cameraKeyframes = scene.camera.keyframes;

  const keyframeCamera = () => {
    const state = getCameraState();
    if (state) upsertCameraKeyframe(playheadMs, state);
  };

  return (
    <div className={styles.inspector}>
      <div className={styles.titleRow}>
        <input
          value={scene.name}
          spellCheck={false}
          onChange={(e) => setSceneName(e.target.value)}
        />
      </div>

      <Section title="Scene">
        <Row label="Duration">
          <NumberField
            value={scene.durationMs / 1000}
            suffix="s"
            onCommit={(v) => setSceneDuration(v * 1000)}
          />
        </Row>
        <Row label="Background">
          <input
            type="color"
            className={styles.colorPicker}
            value={scene.settings.backgroundColor}
            onChange={(e) =>
              patchSettings({ backgroundColor: e.target.value })
            }
          />
        </Row>
      </Section>

      <Section title="Build plate">
        <Row label="Width">
          <NumberField
            value={scene.settings.buildPlateWidth}
            suffix="mm"
            onCommit={(v) => patchSettings({ buildPlateWidth: v })}
          />
        </Row>
        <Row label="Depth">
          <NumberField
            value={scene.settings.buildPlateDepth}
            suffix="mm"
            onCommit={(v) => patchSettings({ buildPlateDepth: v })}
          />
        </Row>
        <Row label="Grid">
          <NumberField
            value={scene.settings.gridSize}
            suffix="mm"
            onCommit={(v) => patchSettings({ gridSize: v })}
          />
        </Row>
      </Section>

      <Section
        title="Camera"
        right={
          <button
            className={styles.smallBtn}
            onClick={keyframeCamera}
            title="Keyframe the camera at the playhead"
          >
            ◆ Keyframe Camera
          </button>
        }
      >
        {cameraKeyframes.length === 0 ? (
          <p className={styles.hint}>
            Move and orient the camera, then add a keyframe to animate it during
            the render.
          </p>
        ) : (
          <div className={styles.kfList}>
            {cameraKeyframes.map((k) => (
              <div key={k.id} className={styles.kfRow}>
                <button
                  className={styles.kfTime}
                  onClick={() => {
                    setPlayhead(k.timeMs);
                    applyCameraState(k);
                  }}
                  title="Jump to this camera keyframe (moves the camera)"
                >
                  ◆ {(k.timeMs / 1000).toFixed(2)}s
                </button>
                <span />
                <button
                  className={styles.kfDelete}
                  onClick={() => removeCameraKeyframe(k.id)}
                  title="Delete camera keyframe"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className={styles.empty}>
        <p className={styles.hint}>
          Click an object to edit its transform, material, and keyframes. Length
          in millimeters, angles in degrees.
        </p>
      </div>
    </div>
  );
}

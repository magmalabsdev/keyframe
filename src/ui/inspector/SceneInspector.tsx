import { useRef, useState } from 'react';
import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import {
  getCameraState,
  orientationAngles,
  targetFromAngles,
} from '../../viewport/cameraApi';
import { applyCameraTransformEdit } from '../../animation/transformEdit';
import { evaluateCamera } from '../../animation/evaluate';
import { getMediaUrl } from '../../io/mediaCache';
import { importMediaFile } from '../../io/importMedia';
import type { Tracks } from '../../state/types';
import { DEFAULT_AMBIENT_INTENSITY, DEFAULT_FPS } from '../../state/defaults';
import { NumberField, Row, Section, Slider, Vec3Field } from './fields';
import styles from './inspector.module.css';

/** Sorted, de-duplicated times that have a keyframe on any camera channel. */
function cameraKeyframeTimes(tracks: Tracks): number[] {
  const set = new Set<number>();
  for (const track of Object.values(tracks)) {
    if (track) for (const k of track) set.add(k.timeMs);
  }
  return [...set].sort((a, b) => a - b);
}

export function SceneInspector() {
  const scene = useActiveScene();
  const setSceneName = useDocumentStore((s) => s.setSceneName);
  const setSceneDuration = useDocumentStore((s) => s.setSceneDuration);
  const patchSettings = useDocumentStore((s) => s.patchSceneSettings);
  const upsertCameraKeyframe = useDocumentStore((s) => s.upsertCameraKeyframe);
  const removeCameraKeyframeAtTime = useDocumentStore((s) => s.removeCameraKeyframeAtTime);
  const cycleKeyframe = useDocumentStore((s) => s.cycleKeyframe);
  const variables = useDocumentStore((s) => s.project.variables);
  const addVariable = useDocumentStore((s) => s.addVariable);
  const setVariableName = useDocumentStore((s) => s.setVariableName);
  const setVariableValue = useDocumentStore((s) => s.setVariableValue);
  const setVariableExpr = useDocumentStore((s) => s.setVariableExpr);
  const removeVariable = useDocumentStore((s) => s.removeVariable);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const backgroundMediaId = scene.settings.backgroundMediaId;
  const backgroundMedia = useDocumentStore((s) =>
    backgroundMediaId ? s.project.media[backgroundMediaId] : undefined,
  );
  const bgInput = useRef<HTMLInputElement>(null);

  const cameraTracks = scene.camera.tracks;
  const cameraPose = evaluateCamera(scene.camera.default, cameraTracks, playheadMs);
  const cameraKfTimes = cameraKeyframeTimes(cameraTracks);
  const [orientationMode, setOrientationMode] = useState<'lookAt' | 'angles'>('lookAt');

  const keyframeCamera = () => {
    const state = getCameraState();
    if (state) upsertCameraKeyframe(playheadMs, state);
  };

  const targetChannels = ['target.0', 'target.1', 'target.2'] as const;
  const orientationKeyed = targetChannels.every(
    (ch) => (cameraTracks[ch] ?? []).some((k) => Math.abs(k.timeMs - playheadMs) <= 1),
  );
  const orientationAnimated = targetChannels.some((ch) => (cameraTracks[ch]?.length ?? 0) > 0);
  const toggleOrientationKeyframe = () => {
    for (const ch of targetChannels) cycleKeyframe(`camera:${ch}`, playheadMs);
  };
  const { yawDeg, pitchDeg } = orientationAngles(cameraPose.position, cameraPose.target);
  const lookDistance = Math.hypot(
    cameraPose.target[0] - cameraPose.position[0],
    cameraPose.target[1] - cameraPose.position[1],
    cameraPose.target[2] - cameraPose.position[2],
  );

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
        <Row label="Frame rate">
          <NumberField
            value={scene.settings.fps ?? DEFAULT_FPS}
            suffix="fps"
            onCommit={(v) => patchSettings({ fps: Math.max(1, Math.round(v)) })}
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
        <Row label="Background media">
          {backgroundMedia ? (
            <div className={styles.mediaPreview}>
              {backgroundMedia.kind === 'image' ? (
                <img src={getMediaUrl(backgroundMedia.id)} alt={backgroundMedia.name} />
              ) : (
                <span className={styles.mediaLabel}>🎬 {backgroundMedia.name}</span>
              )}
              {backgroundMedia.kind === 'image' && (
                <span className={styles.mediaLabel}>{backgroundMedia.name}</span>
              )}
              <button onClick={() => patchSettings({ backgroundMediaId: undefined })}>
                Remove
              </button>
            </div>
          ) : (
            <button onClick={() => bgInput.current?.click()}>Upload image/gif/video</button>
          )}
          <input
            ref={bgInput}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const kind = file.type.startsWith('video/') ? 'video' : 'image';
                void importMediaFile(file, kind).then((mediaId) =>
                  patchSettings({ backgroundMediaId: mediaId }),
                );
              }
              e.target.value = '';
            }}
          />
        </Row>
        <Row label="Ambient light">
          <Slider
            value={scene.settings.ambientIntensity ?? DEFAULT_AMBIENT_INTENSITY}
            onChange={(v) => patchSettings({ ambientIntensity: v })}
            display={(v) => v.toFixed(2)}
          />
        </Row>
        <div className={styles.hint}>
          Fill light so faces turned away from your lights aren't black. 0 = lit
          only by light objects.
        </div>
      </Section>

      <Section title="Build plate">
        <Row label="Width">
          <NumberField
            value={scene.settings.buildPlateWidth}
            suffix="mm"
            bindKey={`scene:${scene.id}:buildPlateWidth`}
            onCommit={(v) => patchSettings({ buildPlateWidth: v })}
          />
        </Row>
        <Row label="Depth">
          <NumberField
            value={scene.settings.buildPlateDepth}
            suffix="mm"
            bindKey={`scene:${scene.id}:buildPlateDepth`}
            onCommit={(v) => patchSettings({ buildPlateDepth: v })}
          />
        </Row>
        <Row label="Grid">
          <NumberField
            value={scene.settings.gridSize}
            suffix="mm"
            bindKey={`scene:${scene.id}:gridSize`}
            onCommit={(v) => patchSettings({ gridSize: v })}
          />
        </Row>
      </Section>

      <Section
        title="Variables"
        right={
          <button className={styles.smallBtn} onClick={addVariable} title="Add a variable">
            + Add
          </button>
        }
      >
        {variables.length === 0 ? (
          <p className={styles.hint}>
            Add named numbers, then type their name (or an expression like
            <b> width*2</b>) into any length/angle field to bind it.
          </p>
        ) : (
          <div className={styles.varList}>
            {variables.map((v) => (
              <div key={v.id} className={styles.varRow}>
                <input
                  className={styles.varName}
                  value={v.name}
                  spellCheck={false}
                  onChange={(e) => setVariableName(v.id, e.target.value)}
                />
                <NumberField
                  value={v.value}
                  onCommit={(n) => setVariableValue(v.id, n)}
                  keyframeKey={`var:${v.id}`}
                  binding={{
                    expr: v.expr,
                    commitExpr: (e) => setVariableExpr(v.id, e),
                    commitNumber: (n) => setVariableValue(v.id, n),
                  }}
                />
                <button
                  className={styles.kfDelete}
                  onClick={() => removeVariable(v.id)}
                  title="Delete variable"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={orientationAnimated || cameraKfTimes.length > 0 ? 'Camera · at playhead' : 'Camera'}
        right={
          <button
            className={styles.smallBtn}
            onClick={keyframeCamera}
            title="Bake the live camera's position + orientation as a keyframe at the playhead"
          >
            ◆ Keyframe Camera
          </button>
        }
      >
        <Row label="Position">
          <Vec3Field
            value={cameraPose.position}
            suffix="mm"
            keyframeKeyBase="camera:position"
            onCommit={(v) => applyCameraTransformEdit({ position: v })}
          />
        </Row>
        <Row label="Orientation">
          <div className={styles.modeToggle}>
            <button
              className={`${styles.smallBtn} ${orientationMode === 'lookAt' ? 'primary' : ''}`}
              onClick={() => setOrientationMode('lookAt')}
              title="Edit orientation as a Look At point (X/Y/Z)"
            >
              Look At
            </button>
            <button
              className={`${styles.smallBtn} ${orientationMode === 'angles' ? 'primary' : ''}`}
              onClick={() => setOrientationMode('angles')}
              title="Edit orientation as Yaw/Pitch angles"
            >
              Yaw/Pitch
            </button>
          </div>
          {orientationMode === 'lookAt' ? (
            <Vec3Field
              value={cameraPose.target}
              suffix="mm"
              keyframeKeyBase="camera:target"
              onCommit={(v) => applyCameraTransformEdit({ target: v })}
            />
          ) : (
            <div className={styles.vec3}>
              <div>
                <div className={styles.miniLabel}>Yaw</div>
                <NumberField
                  suffix="°"
                  value={yawDeg}
                  onCommit={(v) =>
                    applyCameraTransformEdit({
                      target: targetFromAngles(cameraPose.position, v, pitchDeg, lookDistance),
                    })
                  }
                />
              </div>
              <div>
                <div className={styles.miniLabel}>Pitch</div>
                <NumberField
                  suffix="°"
                  value={pitchDeg}
                  onCommit={(v) =>
                    applyCameraTransformEdit({
                      target: targetFromAngles(cameraPose.position, yawDeg, v, lookDistance),
                    })
                  }
                />
              </div>
              <button
                type="button"
                className={`${styles.kfDiamond} ${orientationKeyed ? styles.kfDiamondOn : ''} ${
                  orientationAnimated && !orientationKeyed ? styles.kfDiamondTrack : ''
                }`}
                title={
                  orientationKeyed
                    ? 'Remove the orientation keyframe here (all axes)'
                    : 'Add an orientation keyframe here (all axes)'
                }
                onClick={toggleOrientationKeyframe}
              >
                {orientationKeyed ? '◆' : '◇'}
              </button>
            </div>
          )}
        </Row>
        {cameraKfTimes.length === 0 ? (
          <p className={styles.hint}>
            Move and orient the camera, or key individual values above, to
            animate it during the render.
          </p>
        ) : (
          <div className={styles.kfList}>
            {cameraKfTimes.map((t) => (
              <div key={t} className={styles.kfRow}>
                <button
                  className={styles.kfTime}
                  onClick={() => setPlayhead(t)}
                  title="Jump to this camera keyframe"
                >
                  ◆ {(t / 1000).toFixed(2)}s
                </button>
                <span />
                <button
                  className={styles.kfDelete}
                  onClick={() => removeCameraKeyframeAtTime(t)}
                  title="Delete all camera keyframes at this time"
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

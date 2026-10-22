import { useState } from 'react';
import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import {
  getCameraState,
  orientationAngles,
  targetFromAngles,
} from '../../viewport/cameraApi';
import { applyCameraFovEdit, applyCameraTransformEdit } from '../../animation/transformEdit';
import { evaluateCamera, evaluateCameraFov } from '../../animation/evaluate';
import { MAX_FOV, MIN_FOV, type Tracks } from '../../state/types';
import { CameraIcon } from '../ObjectTypeIcon';
import { NumberField, Row, Section, Vec3Field } from './fields';
import styles from './inspector.module.css';

/** Sorted, de-duplicated times that have a keyframe on any camera channel. */
function cameraKeyframeTimes(tracks: Tracks): number[] {
  const set = new Set<number>();
  for (const track of Object.values(tracks)) {
    if (track) for (const k of track) set.add(k.timeMs);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The scene camera's panel, shown when its row in the objects list is selected.
 * The camera is not a SceneObject (it lives on `Scene.camera`), so this is a
 * sibling of ObjectInspector rather than a branch inside it.
 */
export function CameraInspector() {
  const scene = useActiveScene();
  const upsertCameraKeyframe = useDocumentStore((s) => s.upsertCameraKeyframe);
  const removeCameraKeyframeAtTime = useDocumentStore((s) => s.removeCameraKeyframeAtTime);
  const cycleKeyframe = useDocumentStore((s) => s.cycleKeyframe);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const viewMode = useEditorStore((s) => s.viewMode);
  const setViewMode = useEditorStore((s) => s.setViewMode);

  const cameraTracks = scene.camera.tracks;
  const cameraPose = evaluateCamera(scene.camera.default, cameraTracks, playheadMs);
  const fov = evaluateCameraFov(scene.camera, playheadMs);
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
        <span className={styles.typeIcon}>
          <CameraIcon />
        </span>
        <span style={{ flex: 1, fontWeight: 600 }}>Camera</span>
        <button
          className={`${styles.smallBtn} ${viewMode === 'camera' ? 'primary' : ''}`}
          style={{ width: 'auto' }}
          onClick={() => setViewMode(viewMode === 'camera' ? 'freecam' : 'camera')}
          title="Toggle between free navigation and looking through this camera (C)"
        >
          {viewMode === 'camera' ? 'Freecam' : 'Look through'}
        </button>
      </div>

      <Section
        title={orientationAnimated || cameraKfTimes.length > 0 ? 'Transform · at playhead' : 'Transform'}
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
      </Section>

      <Section title="Lens">
        <Row label="Field of view">
          <NumberField
            suffix="°"
            value={fov}
            keyframeKey="camera:fov"
            onCommit={applyCameraFovEdit}
          />
        </Row>
        <p className={styles.hint}>
          Vertical angle of the 16:9 frame the camera renders ({MIN_FOV}–{MAX_FOV}°).
          Lower is more zoomed in; keyframe it for a push in or out.
        </p>
      </Section>

      <Section title="Keyframes">
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
    </div>
  );
}

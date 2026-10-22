import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { evaluateCamera, evaluateCameraFov } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';
import { advancePlayhead } from '../animation/playback';
import { resolveVariables } from '../animation/variables';
import { applyObjectPose, buildNameMap } from '../render/applyPose';
import { DEFAULT_FOV, type Project } from '../state/types';
import { getControls } from './cameraApi';

/**
 * Single source of truth for object poses each frame. Drives every mesh's
 * transform/visibility from the evaluator, keeping React out of the hot path.
 *
 * Performance: the heavy per-object pass only runs on "dirty" frames — while
 * playing, when the playhead moved, or when the document changed (immer gives a
 * new `project` reference on any edit). Idle frames cost ~nothing. The mesh
 * lookup uses one name map built per dirty frame (O(N)) instead of a
 * getObjectByName traversal per object (O(N^2)).
 */
export function AnimationSystem() {
  const threeScene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const lastTime = useRef(-1);
  const lastProject = useRef<Project | null>(null);
  const lastViewMode = useRef<string | null>(null);

  useFrame(({ camera }, delta) => {
    const editor = useEditorStore.getState();
    // The video exporter drives the scene itself; don't fight it.
    if (editor.exportProgress != null) return;
    const project = useDocumentStore.getState().project;
    const scene = getActiveScene(project);

    let time = editor.playheadMs;
    const playing = editor.playing;
    if (playing && editor.playRate !== 0) {
      // A backgrounded tab hands back a multi-second delta on return; cap it so
      // playback stalls for a moment rather than teleporting down the timeline.
      const deltaMs = Math.min(delta * 1000, 100);
      const next = advancePlayhead({
        timeMs: time,
        rate: editor.playRate,
        deltaMs,
        durationMs: scene.durationMs,
        loop: editor.loop,
        inMs: editor.inMs,
        outMs: editor.outMs,
        stopAtMs: editor.stopAtMs,
      });
      time = next.timeMs;
      editor.setPlayhead(time);
      if (next.stop) editor.stopPlayback();
    }

    const dirty =
      playing ||
      time !== lastTime.current ||
      project !== lastProject.current ||
      editor.viewMode !== lastViewMode.current;
    if (dirty) {
      const nameMap = buildNameMap(threeScene);
      const ctx = {
        bindings: project.bindings,
        vars: resolveVariables(project, time),
        objectById: new Map(scene.objects.map((o) => [o.id, o])),
      };
      for (const obj of scene.objects) {
        if (obj.id === editor.draggingId) continue;
        applyObjectPose(nameMap, obj, poseObjectAtTime(obj, time, ctx));
      }
      lastTime.current = time;
      lastProject.current = project;
      lastViewMode.current = editor.viewMode;

      // In 'camera' mode the viewport always shows exactly what the scene
      // camera sees (its default pose when there are no keyframes), and manual
      // navigation is disabled in CameraRig — so driving it here can never
      // fight the user. In 'freecam' mode, never touch the camera from here:
      // that's what lets the user navigate freely even while scrubbing or
      // playing a scene whose camera has keyframe tracks.
      if (editor.viewMode === 'camera') {
        const cam = evaluateCamera(scene.camera.default, scene.camera.tracks, time);
        getControls()?.setLookAt(
          cam.position[0], cam.position[1], cam.position[2],
          cam.target[0], cam.target[1], cam.target[2],
          false,
        );
      }

      // Looking through the camera means using its lens too; freecam keeps the
      // viewport's own default lens. Reproject only on an actual change:
      // updateProjectionMatrix every frame would defeat the demand frameloop.
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        const fov =
          editor.viewMode === 'camera'
            ? evaluateCameraFov(scene.camera, time)
            : DEFAULT_FOV;
        if (persp.fov !== fov) {
          persp.fov = fov;
          persp.updateProjectionMatrix();
        }
      }
    }

    // In demand mode, keep requesting frames while the animation advances.
    if (playing) invalidate();
  });

  return null;
}

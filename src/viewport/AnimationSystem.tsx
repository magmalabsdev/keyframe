import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { evaluateCamera } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';
import { advancePlayhead } from '../animation/playback';
import { resolveVariables } from '../animation/variables';
import { applyObjectPose, buildNameMap } from '../render/applyPose';
import type { Project } from '../state/types';
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

  useFrame((_, delta) => {
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
      playing || time !== lastTime.current || project !== lastProject.current;
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

      // Drive the camera from its keyframes whenever the frame is dirty (playing
      // or the playhead was scrubbed), the same as objects — previewing camera
      // animation by scrubbing requires this, not just playback. Manual camera
      // navigation never touches playheadMs or the document, so it can't fight
      // this: the drive only reasserts when the playhead itself moves.
      const hasCameraTracks = Object.values(scene.camera.tracks ?? {}).some(
        (t) => t && t.length > 0,
      );
      if (hasCameraTracks) {
        const cam = evaluateCamera(scene.camera.default, scene.camera.tracks, time);
        getControls()?.setLookAt(
          cam.position[0], cam.position[1], cam.position[2],
          cam.target[0], cam.target[1], cam.target[2],
          false,
        );
      }
    }

    // In demand mode, keep requesting frames while the animation advances.
    if (playing) invalidate();
  });

  return null;
}

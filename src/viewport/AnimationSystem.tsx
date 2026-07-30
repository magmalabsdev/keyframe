import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { evaluateCamera } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';
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
    if (playing) {
      time += delta * 1000;
      if (time >= scene.durationMs) {
        time = scene.durationMs;
        editor.setPlayhead(time);
        editor.setPlaying(false);
      } else {
        editor.setPlayhead(time);
      }
    }

    const dirty =
      playing || time !== lastTime.current || project !== lastProject.current;
    if (dirty) {
      const nameMap = buildNameMap(threeScene);
      const ctx = { bindings: project.bindings, vars: resolveVariables(project, time) };
      for (const obj of scene.objects) {
        if (obj.id === editor.draggingId) continue;
        applyObjectPose(nameMap, obj, poseObjectAtTime(obj, time, ctx));
      }
      lastTime.current = time;
      lastProject.current = project;

      // Drive the camera from its keyframes during playback only.
      if (playing && scene.camera.keyframes.length > 0) {
        const cam = evaluateCamera(scene.camera.default, scene.camera.keyframes, time);
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

import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import {
  evaluateCamera,
  evaluateObject,
  isObjectActive,
} from '../animation/evaluate';
import { getControls } from './cameraApi';

const d2r = THREE.MathUtils.degToRad;

/**
 * Single source of truth for object poses each frame. Reads the playhead (or
 * advances it during playback) and imperatively drives every mesh's transform
 * and visibility from the evaluator — keeping React out of the 60fps hot path.
 * The object actively being gizmo-dragged is skipped so edits aren't overridden.
 */
export function AnimationSystem() {
  const threeScene = useThree((s) => s.scene);

  useFrame((_, delta) => {
    const editor = useEditorStore.getState();
    // The video exporter drives the scene itself; don't fight it.
    if (editor.exportProgress != null) return;
    const scene = getActiveScene(useDocumentStore.getState().project);

    let time = editor.playheadMs;
    if (editor.playing) {
      time += delta * 1000;
      if (time >= scene.durationMs) time = 0; // loop
      editor.setPlayhead(time);
    }

    for (const obj of scene.objects) {
      if (obj.id === editor.draggingId) continue;
      const mesh = threeScene.getObjectByName(obj.id);
      if (!mesh) continue;
      mesh.visible = obj.visible && isObjectActive(obj, time);
      const t = evaluateObject(obj, time);
      mesh.position.set(t.position[0], t.position[1], t.position[2]);
      mesh.rotation.set(d2r(t.rotation[0]), d2r(t.rotation[1]), d2r(t.rotation[2]));
      mesh.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    }

    // Drive the camera from its keyframes during playback only.
    if (editor.playing && scene.camera.keyframes.length > 0) {
      const cam = evaluateCamera(
        scene.camera.default,
        scene.camera.keyframes,
        time,
      );
      getControls()?.setLookAt(
        cam.position[0],
        cam.position[1],
        cam.position[2],
        cam.target[0],
        cam.target[1],
        cam.target[2],
        false,
      );
    }
  });

  return null;
}

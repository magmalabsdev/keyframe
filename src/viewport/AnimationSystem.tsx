import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { evaluateCamera } from '../animation/evaluate';
import { poseObjectAtTime } from '../animation/pose';
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
      if (time >= scene.durationMs) {
        // Play once, then stop at the end (also exits render preview).
        time = scene.durationMs;
        editor.setPlayhead(time);
        editor.setPlaying(false);
      } else {
        editor.setPlayhead(time);
      }
    }

    for (const obj of scene.objects) {
      if (obj.id === editor.draggingId) continue;
      const mesh = threeScene.getObjectByName(obj.id);
      if (!mesh) continue;
      const p = poseObjectAtTime(obj, time);
      mesh.visible = p.visible;
      mesh.position.set(p.position[0], p.position[1], p.position[2]);
      mesh.rotation.set(d2r(p.rotation[0]), d2r(p.rotation[1]), d2r(p.rotation[2]));
      mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]);
      if (obj.assetId) {
        const inner = threeScene.getObjectByName(`${obj.id}__mesh`) as
          | THREE.Mesh
          | undefined;
        const mat = inner?.material as THREE.MeshStandardMaterial | undefined;
        if (mat) {
          const opacity = obj.material.opacity * p.opacityMul;
          mat.opacity = opacity;
          mat.transparent = opacity < 1;
        }
      }
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

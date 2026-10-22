import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { getActiveScene, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { evaluateCamera, evaluateCameraFov } from '../animation/evaluate';
import { poseFrustum, unitFrustumPositions } from './frustumGeometry';

/** Half-extent of the little cube marking the camera body, in mm. */
const BODY_SIZE = 16;

const COLOR_IDLE = '#9aa3b2';
const COLOR_SELECTED = '#2554c7';

/**
 * Wireframe pyramid showing what the scene camera sees — the camera's
 * equivalent of the light's directional arrow.
 *
 * Posed imperatively each frame from the camera's evaluated pose rather than
 * from React state, so it follows scrubbing and playback the same way
 * AnimationSystem drives object poses.
 */
export function CameraFrustum() {
  const bodyRef = useRef<THREE.Group>(null);
  const coneRef = useRef<THREE.Group>(null);
  const renderPreview = useEditorStore((s) => s.renderPreview);
  const viewMode = useEditorStore((s) => s.viewMode);
  const cameraSelected = useEditorStore((s) => s.cameraSelected);

  const positions = useMemo(unitFrustumPositions, []);
  const color = cameraSelected ? COLOR_SELECTED : COLOR_IDLE;

  // Hidden while looking through the camera — the eye sits at the apex, so the
  // pyramid would wrap around the view — and while previewing a clean render.
  const hidden = renderPreview || viewMode === 'camera';

  useFrame(() => {
    const body = bodyRef.current;
    const cone = coneRef.current;
    if (!body || !cone || hidden) return;

    const scene = getActiveScene(useDocumentStore.getState().project);
    const timeMs = useEditorStore.getState().playheadMs;
    poseFrustum(
      body,
      cone,
      evaluateCamera(scene.camera.default, scene.camera.tracks, timeMs),
      evaluateCameraFov(scene.camera, timeMs),
    );
  });

  return (
    <group
      ref={bodyRef}
      name="__cameraFrustum"
      visible={!hidden}
      // Display only: the camera is selected from the objects list, never by
      // clicking here, and it is never part of an export.
      userData={{ excludeFromRender: true }}
    >
      <mesh raycast={() => null}>
        <boxGeometry args={[BODY_SIZE, BODY_SIZE, BODY_SIZE]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <group ref={coneRef}>
        <lineSegments raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={color} toneMapped={false} />
        </lineSegments>
      </group>
    </group>
  );
}

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import * as THREE from 'three';
import { registerControls, getControls } from './cameraApi';
import { getR3F } from '../render/renderApi';

const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _planeHit = new THREE.Vector3();

const MOVE_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'q',
  'e',
  '+',
  '=',
  '-',
  '_',
]);

function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

/**
 * Camera navigation per the spec:
 *  - Right-drag (or perspective cube) = orbit
 *  - Middle-drag or WASD / E,Q = pan / move
 *  - Wheel or +/- = zoom
 * Left mouse is left free for object selection (Phase 2).
 */
export function CameraRig() {
  const ref = useRef<CameraControlsImpl | null>(null);
  const keys = useRef<Set<string>>(new Set());
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Demand frameloop: redraw whenever camera-controls reports a change.
    const onUpdate = () => invalidate();
    c.addEventListener('update', onUpdate);
    const ACTION = CameraControlsImpl.ACTION;
    c.mouseButtons.left = ACTION.NONE;
    c.mouseButtons.right = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.TRUCK;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.dollyToCursor = true;
    // Dolly steps are already a percentage of the current distance
    // (camera-controls scales radius by 0.95^(-delta * dollySpeed)); the
    // default dollySpeed of 1 makes each step a ~60% jump, which feels
    // huge from far away and twitchy up close. Soften it.
    c.dollySpeed = 0.3;
    // Static, immediate navigation — no inertia/easing on drag or scroll.
    c.smoothTime = 0;
    c.draggingSmoothTime = 0;
    // No zoom-in limit: allow dollying arbitrarily close / through the target.
    c.minDistance = 0.01;
    c.maxDistance = Infinity;
    c.infinityDolly = true;
    // The camera uses Z as up; tell camera-controls so orbit math is correct.
    c.updateCameraUp();
    registerControls(c);
    return () => {
      c.removeEventListener('update', onUpdate);
      if (getControls() === c) registerControls(null);
    };
  }, [invalidate]);

  // Right-drag orbits around the point under the cursor (Blender/Bambu-style)
  // instead of the camera's current target.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const root = getR3F();
      if (!root) return;

      const r = root.gl.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      _ray.setFromCamera(_ndc, root.camera);

      const objectHit = _ray
        .intersectObjects(root.scene.children, true)
        .find((h) => h.object.name?.endsWith('__mesh'));
      const hasPlaneHit = _ray.ray.intersectPlane(_groundPlane, _planeHit) != null;

      let point: THREE.Vector3 | null = null;
      if (objectHit && hasPlaneHit) {
        point = objectHit.distance < _ray.ray.origin.distanceTo(_planeHit)
          ? objectHit.point
          : _planeHit;
      } else if (objectHit) {
        point = objectHit.point;
      } else if (hasPlaneHit) {
        point = _planeHit;
      }

      if (point) c.setOrbitPoint(point.x, point.y, point.z);
    };

    const dom = getR3F()?.gl.domElement;
    dom?.addEventListener('pointerdown', onPointerDown);
    return () => dom?.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    // Demand frameloop: while movement keys are held, keep requesting frames so
    // the useFrame mover below ticks (it otherwise wouldn't run when idle).
    let raf = 0;
    const pump = () => {
      if (keys.current.size > 0) {
        invalidate();
        raf = requestAnimationFrame(pump);
      } else {
        raf = 0;
      }
    };
    const startPump = () => {
      if (!raf) raf = requestAnimationFrame(pump);
    };
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget()) return;
      // macOS does not deliver keyup while a modifier (⌘/Ctrl) is held, which
      // would leave movement keys stuck. Ignore + clear movement during modifiers.
      if (e.metaKey || e.ctrlKey || e.key === 'Meta' || e.key === 'Control') {
        keys.current.clear();
        return;
      }
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k)) {
        keys.current.add(k);
        startPump();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') keys.current.clear();
      else keys.current.delete(e.key.toLowerCase());
    };
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const c = ref.current;
    if (!c) return;
    const k = keys.current;
    if (k.size === 0) return;

    // Speed scales with distance so navigation feels consistent at any zoom.
    const dist = c.distance && Number.isFinite(c.distance) ? c.distance : 1000;
    const speed = dist * 1.2 * delta;

    let truckX = 0;
    let truckY = 0;
    if (k.has('a')) truckX -= speed;
    if (k.has('d')) truckX += speed;
    if (k.has('e')) truckY += speed;
    if (k.has('q')) truckY -= speed;
    if (truckX !== 0 || truckY !== 0) c.truck(truckX, truckY, false);

    let forward = 0;
    if (k.has('w')) forward += speed;
    if (k.has('s')) forward -= speed;
    if (forward !== 0) c.forward(forward, false);

    let dolly = 0;
    if (k.has('+') || k.has('=')) dolly += speed;
    if (k.has('-') || k.has('_')) dolly -= speed;
    if (dolly !== 0) c.dolly(dolly, false);
  });

  return <CameraControls ref={ref} makeDefault />;
}

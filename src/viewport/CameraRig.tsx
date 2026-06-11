import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { registerControls, getControls } from './cameraApi';

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

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ACTION = CameraControlsImpl.ACTION;
    c.mouseButtons.left = ACTION.NONE;
    c.mouseButtons.right = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.TRUCK;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.dollyToCursor = true;
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
      if (getControls() === c) registerControls(null);
    };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget()) return;
      // macOS does not deliver keyup while a modifier (⌘/Ctrl) is held, which
      // would leave movement keys stuck. Ignore + clear movement during modifiers.
      if (e.metaKey || e.ctrlKey || e.key === 'Meta' || e.key === 'Control') {
        keys.current.clear();
        return;
      }
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k)) keys.current.add(k);
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
    };
  }, []);

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

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import * as THREE from 'three';
import {
  registerControls,
  getControls,
  recenterOrbitTarget,
  clipPlanesFor,
  safeDistance,
  MIN_DISTANCE,
  MAX_DISTANCE,
} from './cameraApi';
import { getR3F } from '../render/renderApi';
import { isTyping } from '../app/isTyping';

const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _planeHit = new THREE.Vector3();
const _pivot = new THREE.Vector3();

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

/** Fraction of the current distance covered per second while +/- is held. */
const KEY_ZOOM_RATE = 1.2;

/** Fallback dolly speed, used until the first wheel event calibrates it. */
const BASE_DOLLY_SPEED = 0.3;
/** camera-controls scales the orbit radius by `0.95^(-delta * dollySpeed)`. One
 * wheel notch should always produce this `delta * dollySpeed` product — 3.0 is
 * ~16% per notch, matching the hand-tuned feel of the old fixed 0.3 on Chrome. */
const DOLLY_UNITS_PER_NOTCH = 3;

/** Physical scroll notches in a wheel event, per delta mode. */
function wheelNotches(e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>): number {
  if (e.deltaMode === 1) return e.deltaY / 3; // lines (Firefox)
  if (e.ctrlKey) return e.deltaY / 10; // trackpad/browser pinch: fine-grained pixels
  return e.deltaY / 100; // pixels
}

/**
 * Zoom keys, resolved from `e.code` so they survive Shift.
 *
 * `Shift+=` reports `e.key === '+'` on keydown but `'='` on keyup if Shift is
 * released first, so a key-name-based set never sees the release and the camera
 * zooms forever. `e.code` names the physical key and is identical either way.
 */
export function zoomKeyToken(e: Pick<KeyboardEvent, 'code' | 'key'>): '+' | '-' | null {
  if (e.code === 'Equal' || e.code === 'NumpadAdd') return '+';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return '-';
  if (e.key === '+' || e.key === '=') return '+';
  if (e.key === '-' || e.key === '_') return '-';
  return null;
}

/**
 * Undo camera-controls' own wheel normalisation so one physical notch is the
 * same zoom step everywhere.
 *
 * It divides `deltaY` by `isMac ? -1 : -3`, and by a further 10 unless
 * `deltaMode === 1` or `ctrlKey` is set. So a Firefox notch (line-mode) zooms
 * ~3x less than a Chrome notch, a trackpad pinch is 10x hotter per unit than a
 * two-finger scroll, and the `navigator.platform` sniff behind `isMac` is empty
 * in some browsers and silently picks the wrong branch. Returning the dollySpeed
 * that cancels all of that out keeps the felt step constant.
 */
export function wheelDollySpeed(
  e: Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'ctrlKey'>,
  isMac: boolean,
): number {
  const factor = isMac ? -1 : -3;
  const libDelta =
    e.deltaMode === 1 || e.ctrlKey ? e.deltaY / factor : e.deltaY / (factor * 10);
  const notches = wheelNotches(e);
  if (!Number.isFinite(libDelta) || libDelta === 0 || !Number.isFinite(notches)) {
    return BASE_DOLLY_SPEED;
  }
  const speed = (Math.abs(notches) * DOLLY_UNITS_PER_NOTCH) / Math.abs(libDelta);
  return THREE.MathUtils.clamp(speed, 0.02, 5);
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
    // Recalibrated per wheel event by the capture listener below; this is only
    // the value that applies before the first scroll.
    c.dollySpeed = BASE_DOLLY_SPEED;
    // Static, immediate navigation — no inertia/easing on drag or scroll.
    c.smoothTime = 0;
    c.draggingSmoothTime = 0;
    // Zoom-in converts to a fly-through at MIN_DISTANCE rather than stopping:
    // once the radius reaches it, infinityDolly holds the radius and pushes the
    // target forward instead. This only works if minDistance is a distance the
    // geometric decay actually reaches — the old 0.01 never triggered, so the
    // radius just asymptoted toward zero and zoom quietly stalled.
    c.minDistance = MIN_DISTANCE;
    c.maxDistance = MAX_DISTANCE;
    // Toggled per wheel event: on while zooming in (fly-through), off while
    // zooming out so maxDistance is a real stop instead of a backwards push.
    c.infinityDolly = true;
    // The camera uses Z as up; tell camera-controls so orbit math is correct.
    c.updateCameraUp();
    registerControls(c);
    return () => {
      c.removeEventListener('update', onUpdate);
      if (getControls() === c) registerControls(null);
    };
  }, [invalidate]);

  // Normalise each wheel event before camera-controls sees it (it listens in
  // bubble phase on the same element, so this capture listener runs first).
  useEffect(() => {
    const c = ref.current;
    const dom = getR3F()?.gl.domElement;
    if (!c || !dom) return;
    const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
    const onWheel = (e: WheelEvent) => {
      c.dollySpeed = wheelDollySpeed(e, isMac);
      // deltaY < 0 is scroll-up, which camera-controls treats as zoom-in.
      c.infinityDolly = e.deltaY < 0;
    };
    dom.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => dom.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

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

      if (!point) return;
      c.setOrbitPoint(point.x, point.y, point.z);
      _pivot.copy(point);

      // setOrbitPoint parks a permanent focalOffset on the controls to fake
      // orbiting off-centre. That offset is a fixed world length added after the
      // spherical placement, so it becomes a hard floor on how close zoom can
      // get — a different floor for every right-click position, which is what
      // made zoom look like it capped at random. Fold it back into the target as
      // soon as the drag ends; the view is unchanged, the floor is gone.
      const onPointerUp = (ev: PointerEvent) => {
        // pointercancel carries no button, so only filter actual pointerups.
        if (ev.type === 'pointerup' && ev.button !== 2) return;
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerUp, true);
        recenterOrbitTarget(_pivot);
        invalidate();
      };
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
    };

    const dom = getR3F()?.gl.domElement;
    dom?.addEventListener('pointerdown', onPointerDown);
    return () => dom?.removeEventListener('pointerdown', onPointerDown);
  }, [invalidate]);

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
      // A global shortcut already claimed this key: don't also move the camera.
      // Both listeners are on window, so without this they fire in parallel.
      if (e.defaultPrevented) return;
      if (isTyping()) return;
      // macOS does not deliver keyup while a modifier (⌘/Ctrl) is held, which
      // would leave movement keys stuck. Ignore + clear movement during modifiers.
      if (e.metaKey || e.ctrlKey || e.key === 'Meta' || e.key === 'Control') {
        keys.current.clear();
        return;
      }
      const zoom = zoomKeyToken(e);
      const k = zoom ?? e.key.toLowerCase();
      if (zoom || MOVE_KEYS.has(k)) {
        keys.current.add(k);
        startPump();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') keys.current.clear();
      else keys.current.delete(zoomKeyToken(e) ?? e.key.toLowerCase());
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

  useFrame(({ camera }, delta) => {
    const c = ref.current;
    if (!c) return;

    // Keep the clip planes sized to where the camera actually is. Retune only on
    // a meaningful change: updateProjectionMatrix every frame would defeat the
    // demand frameloop.
    const { near, far } = clipPlanesFor(c.distance);
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.near / near - 1) > 0.1 || Math.abs(cam.far / far - 1) > 0.1) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
      invalidate();
    }

    const k = keys.current;
    if (k.size === 0) return;

    // Speed scales with distance so navigation feels consistent at any zoom.
    const dist = safeDistance(c.distance);
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

    // Zoom keys mirror the wheel: a geometric step, and a fly-through rather
    // than a hard stop up close. c.dolly() would instead route through dollyTo,
    // which clamps at minDistance and resets the dolly-to-cursor state — so the
    // keys used to stop dead where the wheel kept going.
    const zoomSign = (k.has('+') ? 1 : 0) - (k.has('-') ? 1 : 0);
    if (zoomSign !== 0) {
      const next = dist * Math.exp(-zoomSign * KEY_ZOOM_RATE * delta);
      if (next < MIN_DISTANCE) c.dollyInFixed(dist - next, false);
      else void c.dollyTo(Math.min(next, MAX_DISTANCE), false);
    }
  });

  return <CameraControls ref={ref} makeDefault />;
}

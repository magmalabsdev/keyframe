import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeFacePlacement } from './facePlacement';

/** A 100x60 rectangle on the z = 20 plane. */
function quad(z: number): THREE.Vector3[] {
  return [
    new THREE.Vector3(-50, -30, z),
    new THREE.Vector3(50, -30, z),
    new THREE.Vector3(50, 30, z),
    new THREE.Vector3(-50, 30, z),
  ];
}

/** Applies a placement's Euler rotation to the surface's local +Z. */
function placedNormal(rotation: [number, number, number]): THREE.Vector3 {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    'XYZ',
  );
  return new THREE.Vector3(0, 0, 1).applyEuler(euler);
}

describe('computeFacePlacement', () => {
  it('lays a surface flat on an upward face, offset above it', () => {
    const p = computeFacePlacement(quad(20), new THREE.Vector3(0, 0, 1))!;
    expect(p.position[0]).toBeCloseTo(0);
    expect(p.position[1]).toBeCloseTo(0);
    expect(p.position[2]).toBeCloseTo(20.5); // face + 0.5mm gap
    expect(placedNormal(p.rotation).z).toBeCloseTo(1);
  });

  it('insets the polygon inside the face bounds', () => {
    const p = computeFacePlacement(quad(0), new THREE.Vector3(0, 0, 1))!;
    expect(p.width).toBeCloseTo(85); // 100 * 0.85
    expect(p.height).toBeCloseTo(51); // 60 * 0.85
  });

  it('produces a finite rotation for a downward face', () => {
    // The antiparallel case: a bare setFromUnitVectors has no defined axis
    // here and can yield NaN or an arbitrary roll.
    const p = computeFacePlacement(quad(-20), new THREE.Vector3(0, 0, -1))!;
    for (const r of p.rotation) expect(Number.isFinite(r)).toBe(true);
    expect(placedNormal(p.rotation).z).toBeCloseTo(-1);
    expect(p.position[2]).toBeCloseTo(-20.5);
  });

  it('aligns the surface normal to an arbitrary side face', () => {
    const side = [
      new THREE.Vector3(30, -20, 0),
      new THREE.Vector3(30, 20, 0),
      new THREE.Vector3(30, 20, 40),
      new THREE.Vector3(30, -20, 40),
    ];
    const p = computeFacePlacement(side, new THREE.Vector3(1, 0, 0))!;
    const normal = placedNormal(p.rotation);
    expect(normal.x).toBeCloseTo(1);
    expect(normal.y).toBeCloseTo(0);
    expect(normal.z).toBeCloseTo(0);
    expect(p.position[0]).toBeCloseTo(30.5);
  });

  it('rejects degenerate input', () => {
    expect(computeFacePlacement([], new THREE.Vector3(0, 0, 1))).toBeNull();
    expect(
      computeFacePlacement(quad(0).slice(0, 2), new THREE.Vector3(0, 0, 1)),
    ).toBeNull();
    expect(computeFacePlacement(quad(0), new THREE.Vector3(0, 0, 0))).toBeNull();
  });
});

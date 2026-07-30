import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ensureBoxUVs, ensureTileUVs } from './textureUv';

describe('ensureBoxUVs', () => {
  it('adds a uv attribute with values in [0,1] to a UV-less geometry', () => {
    const geometry = new THREE.BufferGeometry();
    // A box's positions/normals without the default UV attribute.
    const box = new THREE.BoxGeometry(10, 20, 30);
    geometry.setAttribute('position', box.getAttribute('position'));
    geometry.setAttribute('normal', box.getAttribute('normal'));
    geometry.setIndex(box.getIndex());
    expect(geometry.getAttribute('uv')).toBeUndefined();

    ensureBoxUVs(geometry);

    const uv = geometry.getAttribute('uv');
    expect(uv).toBeDefined();
    expect(uv.count).toBe(geometry.getAttribute('position').count);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('is idempotent (does not recompute on a second call)', () => {
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    geometry.deleteAttribute('uv');
    ensureBoxUVs(geometry);
    const first = geometry.getAttribute('uv');
    ensureBoxUVs(geometry);
    expect(geometry.getAttribute('uv')).toBe(first);
  });
});

describe('ensureTileUVs', () => {
  it('adds a uv1 attribute with raw mm offsets (not normalized to [0,1])', () => {
    const geometry = new THREE.BoxGeometry(10, 20, 30);
    geometry.deleteAttribute('uv');

    ensureTileUVs(geometry);

    const uv1 = geometry.getAttribute('uv1');
    expect(uv1).toBeDefined();
    expect(uv1.count).toBe(geometry.getAttribute('position').count);

    let sawAboveOne = false;
    for (let i = 0; i < uv1.count; i++) {
      if (uv1.getX(i) > 1 || uv1.getY(i) > 1) sawAboveOne = true;
      expect(uv1.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv1.getY(i)).toBeGreaterThanOrEqual(0);
    }
    expect(sawAboveOne).toBe(true);
  });

  it('is idempotent (does not recompute on a second call)', () => {
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    ensureTileUVs(geometry);
    const first = geometry.getAttribute('uv1');
    ensureTileUVs(geometry);
    expect(geometry.getAttribute('uv1')).toBe(first);
  });
});

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { centerParts, extractParts } from './parts';

function bounds(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max };
}

function mesh(geometry: THREE.BufferGeometry, color?: number, name = ''): THREE.Mesh {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: color ?? 0xffffff }));
  m.name = name;
  return m;
}

describe('extractParts', () => {
  it('converts Y-up to Z-up with world transforms baked in', () => {
    const group = new THREE.Group();
    group.scale.setScalar(2);
    group.position.set(0, 10, 0);
    // Tall along Y in the source file.
    group.add(mesh(new THREE.BoxGeometry(1, 4, 1)));
    const [part] = extractParts(group, 'Tall');
    const { min, max } = bounds(part.data.positions);
    expect(max[2] - min[2]).toBeCloseTo(8);
    expect(max[1] - min[1]).toBeCloseTo(2);
    // Source +Y offset becomes +Z.
    expect((min[2] + max[2]) / 2).toBeCloseTo(10);
  });

  it('makes one part per mesh with colors and de-duplicated names', () => {
    const root = new THREE.Group();
    root.add(mesh(new THREE.BoxGeometry(), 0xff0000, 'Wheel'));
    root.add(mesh(new THREE.BoxGeometry(), 0x00ff00, 'Wheel'));
    root.add(mesh(new THREE.BoxGeometry()));
    root.add(new THREE.Points(new THREE.BoxGeometry()));
    const parts = extractParts(root, 'Car');
    expect(parts.map((p) => p.name)).toEqual(['Wheel', 'Wheel 2', 'Car']);
    expect(parts[0].color).toBe('#ff0000');
    expect(parts[1].color).toBe('#00ff00');
  });

  it('keeps geometry indexed', () => {
    const box = new THREE.BoxGeometry();
    const [part] = extractParts(mesh(box), 'Box');
    expect(part.data.index?.length).toBe(box.getIndex()!.count);
    expect(part.data.positions.length).toBe(box.getAttribute('position').count * 3);
  });

  it('flips winding under a mirroring transform so normals stay outward', () => {
    const m = mesh(new THREE.BoxGeometry());
    m.scale.set(-1, 1, 1);
    const [part] = extractParts(m, 'Mirrored');
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.data.positions, 3));
    g.setIndex(new THREE.BufferAttribute(part.data.index!, 1));
    g.computeVertexNormals();
    const computed = g.getAttribute('normal');
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < computed.count; i++) {
      p.fromBufferAttribute(g.getAttribute('position'), i);
      n.fromBufferAttribute(computed, i);
      expect(n.dot(p)).toBeGreaterThan(0);
    }
  });

  it('throws when there is no mesh geometry', () => {
    expect(() => extractParts(new THREE.Group(), 'Empty')).toThrow(/No mesh geometry/);
  });
});

describe('centerParts', () => {
  it('centers the combined bounds in XY and rests them on z = 0', () => {
    const a = { positions: Float32Array.from([0, 0, 5, 2, 2, 6]) };
    const b = { positions: Float32Array.from([8, 4, 7, 10, 6, 9]) };
    centerParts([a, b]);
    const all = new Float32Array([...a.positions, ...b.positions]);
    const { min, max } = bounds(all);
    expect(min[0] + max[0]).toBeCloseTo(0);
    expect(min[1] + max[1]).toBeCloseTo(0);
    expect(min[2]).toBeCloseTo(0);
    // Relative arrangement is preserved.
    expect(b.positions[0] - a.positions[0]).toBeCloseTo(8);
  });
});

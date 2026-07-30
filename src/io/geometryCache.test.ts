import { describe, it, expect } from 'vitest';
import { buildGeometry } from './geometryCache';
import type { GeometryData } from '../state/types';

/** One non-indexed triangle, the shape STLLoader produces. */
const positions = () => Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0]);

describe('buildGeometry normal repair', () => {
  it('repairs the all-zero facet normals STL files can carry', () => {
    // Zero-length normals make N·L zero for every light, so the mesh renders
    // pure black at any color — the STL-imports-are-black bug.
    const g = buildGeometry({ positions: positions(), normals: new Float32Array(9) });
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
    }
  });

  it('writes the repair back into the caller’s array so persistence heals', () => {
    // buildGeometry wraps `data.normals` without copying and
    // computeVertexNormals() rewrites in place, so a document loaded from
    // IndexedDB or a .kfp heals its stored normals for the next save.
    const normals = new Float32Array(9);
    buildGeometry({ positions: positions(), normals });
    expect(Array.from(normals)).not.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Math.hypot(normals[0], normals[1], normals[2])).toBeCloseTo(1, 5);
  });

  it('leaves valid normals alone', () => {
    const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    buildGeometry({ positions: positions(), normals });
    expect(Array.from(normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('computes normals when none are supplied and records them on the data', () => {
    const data: GeometryData = { positions: positions() };
    const g = buildGeometry(data);
    expect(g.getAttribute('normal')).toBeDefined();
    expect(data.normals).toBe(g.getAttribute('normal').array);
  });

  it('replaces a wrong-sized normal array rather than reusing it', () => {
    const data = { positions: positions(), normals: Float32Array.from([0, 0, 1]) };
    const g = buildGeometry(data);
    expect(g.getAttribute('normal').count).toBe(3);
    expect(data.normals).toHaveLength(9);
  });
});

import * as THREE from 'three';
import type { Material } from '../state/types';

/**
 * A MeshStandardMaterial patched to scatter/assemble fragments on the GPU.
 * The fragmented geometry (see animation/fragments.ts) provides per-vertex
 * attributes; this material reads a single `uProgress` uniform (0 = scattered,
 * 1 = assembled) so the whole effect costs one uniform write per frame.
 *
 * The live uniform is stashed on `material.userData.uProgress` for the driver.
 */
export function createFragmentMaterial(
  material: Material,
  /** `side` matters for flat sources (surface polygons) whose chunks are not
   *  closed solids and would otherwise vanish when seen from behind. */
  opts: { side?: THREE.Side } = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(material.color),
    metalness: material.metalness,
    roughness: material.roughness,
    transparent: true,
    opacity: material.opacity,
    side: opts.side ?? THREE.FrontSide,
  });

  const uProgress = { value: 1 };
  mat.userData.uProgress = uProgress;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uProgress = uProgress;

    shader.vertexShader =
      `
      attribute vec3 aCentroid;
      attribute vec3 aOffset;
      attribute vec3 aAxis;
      attribute float aAngle;
      uniform float uProgress;

      vec3 kf_rotateAxis(vec3 v, vec3 axis, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
      }
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      float kfK = 1.0 - uProgress;
      vec3 kfAxis = normalize(aAxis);
      vec3 objectNormal = kf_rotateAxis(normal, kfAxis, aAngle * kfK);
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
      #endif
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec3 kfRel = position - aCentroid;
      kfRel = kf_rotateAxis(kfRel, kfAxis, aAngle * kfK);
      vec3 transformed = aCentroid + kfRel + aOffset * kfK;
      `,
    );
  };

  return mat;
}

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../state/editorStore';
import { getR3F } from '../render/renderApi';
import { getFaceTriangles } from '../scene/faceGroups';

const _ndc = new THREE.Vector2();
const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();

const HIGHLIGHT_OFFSET = 0.5; // mm, along the face normal, to avoid z-fighting

/**
 * While the "place on face" tool is active, highlights the planar face under
 * the cursor so the user can see which face will be placed face-down.
 */
export function FaceHighlight() {
  const tool = useEditorStore((s) => s.activeTool);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (tool !== 'place') {
      setGeometry(null);
      return;
    }

    let dom: HTMLCanvasElement | null = null;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      const root = getR3F();
      if (!root) return;
      const r = root.gl.domElement.getBoundingClientRect();
      _ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      _ray.setFromCamera(_ndc, root.camera);
      const hit = _ray
        .intersectObjects(root.scene.children, true)
        .find((h) => h.object.name?.endsWith('__mesh') && h.face != null && h.faceIndex != null);

      if (!hit || !hit.face || hit.faceIndex == null) {
        setGeometry((prev) => {
          prev?.dispose();
          return null;
        });
        return;
      }

      const mesh = hit.object as THREE.Mesh;
      const geo = mesh.geometry as THREE.BufferGeometry;
      const position = geo.getAttribute('position');
      const index = geo.getIndex();
      const triIndices = getFaceTriangles(geo, hit.faceIndex);

      mesh.updateMatrixWorld(true);
      const worldNormal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
      const offset = worldNormal.clone().multiplyScalar(HIGHLIGHT_OFFSET);

      const positions: number[] = [];
      for (const t of triIndices) {
        for (let k = 0; k < 3; k++) {
          const idx = index ? index.getX(t * 3 + k) : t * 3 + k;
          _v.fromBufferAttribute(position, idx);
          _v.applyMatrix4(mesh.matrixWorld);
          _v.add(offset);
          positions.push(_v.x, _v.y, _v.z);
        }
      }

      const highlightGeo = new THREE.BufferGeometry();
      highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      setGeometry((prev) => {
        prev?.dispose();
        return highlightGeo;
      });
    };

    const onLeave = () => {
      setGeometry((prev) => {
        prev?.dispose();
        return null;
      });
    };

    const attach = () => {
      const root = getR3F();
      if (!root) {
        raf = requestAnimationFrame(attach);
        return;
      }
      dom = root.gl.domElement;
      dom.addEventListener('pointermove', onMove);
      dom.addEventListener('pointerleave', onLeave);
    };
    attach();

    return () => {
      cancelAnimationFrame(raf);
      dom?.removeEventListener('pointermove', onMove);
      dom?.removeEventListener('pointerleave', onLeave);
      setGeometry((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, [tool]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} renderOrder={999}>
      <meshBasicMaterial
        color="#2ecc71"
        transparent
        opacity={0.4}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

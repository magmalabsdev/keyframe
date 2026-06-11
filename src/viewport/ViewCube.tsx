import { useMemo, useRef } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { getMainCamera, setView, type ViewName } from './cameraApi';
import styles from './ViewCube.module.css';

// three BoxGeometry material order is +X, -X, +Y, -Y, +Z, -Z. Mapped to Z-up
// world faces so labels match the named views in cameraApi.setView.
const FACES: { label: string; view: ViewName }[] = [
  { label: 'RIGHT', view: 'right' }, // +X
  { label: 'LEFT', view: 'left' }, // -X
  { label: 'BACK', view: 'back' }, // +Y
  { label: 'FRONT', view: 'front' }, // -Y
  { label: 'TOP', view: 'top' }, // +Z
  { label: 'BOTTOM', view: 'bottom' }, // -Z
];

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a2f3a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#4a525f';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = '#e7e9ee';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function CubeMesh() {
  const materials = useMemo(
    () =>
      FACES.map(
        (f) =>
          new THREE.MeshBasicMaterial({ map: makeLabelTexture(f.label) }),
      ),
    [],
  );
  const meshRef = useRef<THREE.Mesh>(null);

  // Mirror the main camera's orientation so the cube shows the current view.
  useFrame(({ camera }) => {
    const main = getMainCamera();
    if (!main || !meshRef.current) return;
    camera.quaternion.copy(main.quaternion);
    camera.position
      .set(0, 0, 1)
      .applyQuaternion(main.quaternion)
      .multiplyScalar(3.2);
    camera.updateMatrixWorld();
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const idx = e.face?.materialIndex;
    if (idx != null && FACES[idx]) setView(FACES[idx].view);
  };

  return (
    <mesh
      ref={meshRef}
      material={materials}
      onClick={onClick}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <boxGeometry args={[1.5, 1.5, 1.5]} />
    </mesh>
  );
}

/** Z-up-correct orientation cube overlay in the viewport corner. */
export function ViewCube() {
  return (
    <div className={styles.cube}>
      <Canvas
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 3.2], fov: 40, near: 0.1, far: 50 }}
        style={{ background: 'transparent' }}
      >
        <CubeMesh />
      </Canvas>
    </div>
  );
}

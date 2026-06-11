import { Grid, Line } from '@react-three/drei';
import { useActiveScene } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';

/**
 * The build plate: an infinite reference grid on the XY plane (Z-up), the
 * 1600x900 mm camera framing rectangle, and origin axes. Hidden during a clean
 * render preview or video export.
 */
export function BuildPlate() {
  const scene = useActiveScene();
  const presenting = useEditorStore(
    (s) => s.renderPreview || s.exportProgress != null,
  );
  const { buildPlateWidth: w, buildPlateDepth: d, gridSize } = scene.settings;
  const hw = w / 2;
  const hd = d / 2;

  return (
    <group visible={!presenting} userData={{ excludeFromRender: true }}>
      {/* Reference grid, rotated from drei's default XZ plane onto the XY plane. */}
      <Grid
        rotation={[Math.PI / 2, 0, 0]}
        infiniteGrid
        cellSize={gridSize}
        cellThickness={0.6}
        cellColor="#2b3140"
        sectionSize={gridSize * 5}
        sectionThickness={1}
        sectionColor="#3c4456"
        fadeDistance={6000}
        fadeStrength={1.4}
        followCamera={false}
      />

      {/* Camera framing rectangle (the render area). */}
      <Line
        points={[
          [-hw, -hd, 0],
          [hw, -hd, 0],
          [hw, hd, 0],
          [-hw, hd, 0],
          [-hw, -hd, 0],
        ]}
        color="#4c8bf5"
        lineWidth={1.5}
        transparent
        opacity={0.8}
      />

      {/* Origin axes (X red, Y green, Z blue). */}
      <axesHelper args={[150]} />
    </group>
  );
}

import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import { NumberField, Row, Section } from './fields';
import styles from './inspector.module.css';

export function SceneInspector() {
  const scene = useActiveScene();
  const setSceneName = useDocumentStore((s) => s.setSceneName);
  const setSceneDuration = useDocumentStore((s) => s.setSceneDuration);
  const patchSettings = useDocumentStore((s) => s.patchSceneSettings);

  return (
    <div className={styles.inspector}>
      <div className={styles.titleRow}>
        <input
          value={scene.name}
          spellCheck={false}
          onChange={(e) => setSceneName(e.target.value)}
        />
      </div>

      <Section title="Scene">
        <Row label="Duration">
          <NumberField
            value={scene.durationMs / 1000}
            suffix="s"
            onCommit={(v) => setSceneDuration(v * 1000)}
          />
        </Row>
        <Row label="Background">
          <input
            type="color"
            className={styles.colorPicker}
            value={scene.settings.backgroundColor}
            onChange={(e) =>
              patchSettings({ backgroundColor: e.target.value })
            }
          />
        </Row>
      </Section>

      <Section title="Build plate">
        <Row label="Width">
          <NumberField
            value={scene.settings.buildPlateWidth}
            suffix="mm"
            onCommit={(v) => patchSettings({ buildPlateWidth: v })}
          />
        </Row>
        <Row label="Depth">
          <NumberField
            value={scene.settings.buildPlateDepth}
            suffix="mm"
            onCommit={(v) => patchSettings({ buildPlateDepth: v })}
          />
        </Row>
        <Row label="Grid">
          <NumberField
            value={scene.settings.gridSize}
            suffix="mm"
            onCommit={(v) => patchSettings({ gridSize: v })}
          />
        </Row>
      </Section>

      <div className={styles.empty}>
        <p className={styles.hint}>
          Click an object to edit its transform, material, and keyframes. Length
          in millimeters, angles in degrees.
        </p>
      </div>
    </div>
  );
}

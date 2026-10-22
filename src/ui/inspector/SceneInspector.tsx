import { useRef } from 'react';
import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import { getMediaUrl } from '../../io/mediaCache';
import { importMediaFile } from '../../io/importMedia';
import { DEFAULT_AMBIENT_INTENSITY, DEFAULT_FPS } from '../../state/defaults';
import { NumberField, Row, Section, Slider } from './fields';
import styles from './inspector.module.css';

export function SceneInspector() {
  const scene = useActiveScene();
  const setSceneName = useDocumentStore((s) => s.setSceneName);
  const setSceneDuration = useDocumentStore((s) => s.setSceneDuration);
  const patchSettings = useDocumentStore((s) => s.patchSceneSettings);
  const variables = useDocumentStore((s) => s.project.variables);
  const addVariable = useDocumentStore((s) => s.addVariable);
  const setVariableName = useDocumentStore((s) => s.setVariableName);
  const setVariableValue = useDocumentStore((s) => s.setVariableValue);
  const setVariableExpr = useDocumentStore((s) => s.setVariableExpr);
  const removeVariable = useDocumentStore((s) => s.removeVariable);
  const backgroundMediaId = scene.settings.backgroundMediaId;
  const backgroundMedia = useDocumentStore((s) =>
    backgroundMediaId ? s.project.media[backgroundMediaId] : undefined,
  );
  const bgInput = useRef<HTMLInputElement>(null);

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
        <Row label="Frame rate">
          <NumberField
            value={scene.settings.fps ?? DEFAULT_FPS}
            suffix="fps"
            onCommit={(v) => patchSettings({ fps: Math.max(1, Math.round(v)) })}
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
        <Row label="Background media">
          {backgroundMedia ? (
            <div className={styles.mediaPreview}>
              {backgroundMedia.kind === 'image' ? (
                <img src={getMediaUrl(backgroundMedia.id)} alt={backgroundMedia.name} />
              ) : (
                <span className={styles.mediaLabel}>🎬 {backgroundMedia.name}</span>
              )}
              {backgroundMedia.kind === 'image' && (
                <span className={styles.mediaLabel}>{backgroundMedia.name}</span>
              )}
              <button onClick={() => patchSettings({ backgroundMediaId: undefined })}>
                Remove
              </button>
            </div>
          ) : (
            <button onClick={() => bgInput.current?.click()}>Upload image/gif/video</button>
          )}
          <input
            ref={bgInput}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const kind = file.type.startsWith('video/') ? 'video' : 'image';
                void importMediaFile(file, kind).then((mediaId) =>
                  patchSettings({ backgroundMediaId: mediaId }),
                );
              }
              e.target.value = '';
            }}
          />
        </Row>
        <Row label="Ambient light">
          <Slider
            value={scene.settings.ambientIntensity ?? DEFAULT_AMBIENT_INTENSITY}
            onChange={(v) => patchSettings({ ambientIntensity: v })}
            display={(v) => v.toFixed(2)}
          />
        </Row>
        <div className={styles.hint}>
          Fill light so faces turned away from your lights aren't black. 0 = lit
          only by light objects.
        </div>
      </Section>

      <Section title="Build plate">
        <Row label="Width">
          <NumberField
            value={scene.settings.buildPlateWidth}
            suffix="mm"
            bindKey={`scene:${scene.id}:buildPlateWidth`}
            onCommit={(v) => patchSettings({ buildPlateWidth: v })}
          />
        </Row>
        <Row label="Depth">
          <NumberField
            value={scene.settings.buildPlateDepth}
            suffix="mm"
            bindKey={`scene:${scene.id}:buildPlateDepth`}
            onCommit={(v) => patchSettings({ buildPlateDepth: v })}
          />
        </Row>
        <Row label="Grid">
          <NumberField
            value={scene.settings.gridSize}
            suffix="mm"
            bindKey={`scene:${scene.id}:gridSize`}
            onCommit={(v) => patchSettings({ gridSize: v })}
          />
        </Row>
      </Section>

      <Section
        title="Variables"
        right={
          <button className={styles.smallBtn} onClick={addVariable} title="Add a variable">
            + Add
          </button>
        }
      >
        {variables.length === 0 ? (
          <p className={styles.hint}>
            Add named numbers, then type their name (or an expression like
            <b> width*2</b>) into any length/angle field to bind it.
          </p>
        ) : (
          <div className={styles.varList}>
            {variables.map((v) => (
              <div key={v.id} className={styles.varRow}>
                <input
                  className={styles.varName}
                  value={v.name}
                  spellCheck={false}
                  onChange={(e) => setVariableName(v.id, e.target.value)}
                />
                <NumberField
                  value={v.value}
                  onCommit={(n) => setVariableValue(v.id, n)}
                  keyframeKey={`var:${v.id}`}
                  binding={{
                    expr: v.expr,
                    commitExpr: (e) => setVariableExpr(v.id, e),
                    commitNumber: (n) => setVariableValue(v.id, n),
                  }}
                />
                <button
                  className={styles.kfDelete}
                  onClick={() => removeVariable(v.id)}
                  title="Delete variable"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
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

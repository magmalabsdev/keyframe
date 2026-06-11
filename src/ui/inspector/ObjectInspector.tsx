import { useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { evaluateObject } from '../../animation/evaluate';
import { applyTransformEdit, addKeyframeAtPlayhead } from '../../animation/transformEdit';
import type { Easing, SceneObject } from '../../state/types';
import { ColorField, Row, Section, Slider, Vec3Field } from './fields';
import styles from './inspector.module.css';

const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];

export function ObjectInspector({ object }: { object: SceneObject }) {
  const setObjectName = useDocumentStore((s) => s.setObjectName);
  const setObjectVisible = useDocumentStore((s) => s.setObjectVisible);
  const setMaterial = useDocumentStore((s) => s.setObjectMaterial);
  const removeKeyframe = useDocumentStore((s) => s.removeKeyframe);
  const setKeyframeInterpolation = useDocumentStore((s) => s.setKeyframeInterpolation);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);

  const { id, material } = object;
  // Show the pose at the current playhead so edits reflect (and update) keyframes.
  const t = evaluateObject(object, playheadMs);
  const animated = object.keyframes.length > 0;
  const isGroup = object.type === 'group';

  return (
    <div className={styles.inspector}>
      <div className={styles.titleRow}>
        <input
          value={object.name}
          spellCheck={false}
          onChange={(e) => setObjectName(id, e.target.value)}
        />
        <button
          style={{ width: 'auto' }}
          onClick={() => setObjectVisible(id, !object.visible)}
          title={object.visible ? 'Hide object' : 'Show object'}
        >
          {object.visible ? '◉' : '○'}
        </button>
      </div>

      <Section title={animated ? 'Transform · at playhead' : 'Transform'}>
        <Row label="Position">
          <Vec3Field
            value={t.position}
            suffix="mm"
            onCommit={(v) => applyTransformEdit(id, { ...t, position: v })}
          />
        </Row>
        <Row label="Rotation">
          <Vec3Field
            value={t.rotation}
            suffix="°"
            onCommit={(v) => applyTransformEdit(id, { ...t, rotation: v })}
          />
        </Row>
        <Row label="Scale">
          <Vec3Field
            value={t.scale}
            onCommit={(v) => applyTransformEdit(id, { ...t, scale: v })}
          />
        </Row>
      </Section>

      {!isGroup && (
        <Section title="Material">
          <Row label="Color">
            <ColorField
              value={material.color}
              onChange={(c) => setMaterial(id, { color: c })}
            />
          </Row>
          <Row label="Opacity">
            <Slider
              value={material.opacity}
              onChange={(v) => setMaterial(id, { opacity: v })}
              display={(v) => `${Math.round(v * 100)}%`}
            />
          </Row>
          <Row label="Reflect">
            <Slider
              value={material.metalness}
              onChange={(v) => setMaterial(id, { metalness: v })}
            />
          </Row>
          <Row label="Rough">
            <Slider
              value={material.roughness}
              onChange={(v) => setMaterial(id, { roughness: v })}
            />
          </Row>
        </Section>
      )}

      <Section
        title="Keyframes"
        right={
          <button
            className={styles.smallBtn}
            onClick={() => addKeyframeAtPlayhead(id)}
            title="Add keyframe at playhead (K)"
          >
            ◆ Key
          </button>
        }
      >
        {object.keyframes.length === 0 ? (
          <p className={styles.hint}>
            No keyframes. Move the playhead, pose the object, then press <b>K</b>.
          </p>
        ) : (
          <div className={styles.kfList}>
            {object.keyframes.map((k) => (
              <div key={k.id} className={styles.kfRow}>
                <button
                  className={styles.kfTime}
                  onClick={() => setPlayhead(k.timeMs)}
                  title="Jump to this keyframe"
                >
                  ◆ {(k.timeMs / 1000).toFixed(2)}s
                </button>
                <select
                  value={k.interpolation}
                  onChange={(e) =>
                    setKeyframeInterpolation(id, k.id, e.target.value as Easing)
                  }
                >
                  {EASINGS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.kfDelete}
                  onClick={() => removeKeyframe(id, k.id)}
                  title="Delete keyframe"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

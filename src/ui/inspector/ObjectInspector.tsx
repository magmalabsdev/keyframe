import { useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { evaluateObject } from '../../animation/evaluate';
import { applyTransformEdit, addKeyframeAtPlayhead } from '../../animation/transformEdit';
import {
  defaultIdle,
  defaultTransition,
  type Easing,
  type IdleType,
  type SceneObject,
  type TransitionType,
} from '../../state/types';
import { commitCenterOfRotation } from '../../viewport/PivotHandle';
import { getR3F } from '../../render/renderApi';
import { ColorField, NumberField, Row, Section, Slider, Vec3Field } from './fields';
import styles from './inspector.module.css';

const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];
const IDLE_TYPES: IdleType[] = ['none', 'rotate', 'flicker', 'pulse', 'wiggle'];
const TRANSITION_TYPES: TransitionType[] = ['none', 'pop', 'fade', 'digital', 'flicker'];

export function ObjectInspector({ object }: { object: SceneObject }) {
  const setObjectName = useDocumentStore((s) => s.setObjectName);
  const setObjectVisible = useDocumentStore((s) => s.setObjectVisible);
  const setMaterial = useDocumentStore((s) => s.setObjectMaterial);
  const removeKeyframe = useDocumentStore((s) => s.removeKeyframe);
  const setKeyframeInterpolation = useDocumentStore((s) => s.setKeyframeInterpolation);
  const setObjectIdle = useDocumentStore((s) => s.setObjectIdle);
  const setObjectTransition = useDocumentStore((s) => s.setObjectTransition);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const corEditId = useEditorStore((s) => s.corEditId);
  const setCorEditId = useEditorStore((s) => s.setCorEditId);

  const { id, material } = object;
  const idle = object.idle ?? defaultIdle();
  const startAnim = object.startAnim ?? defaultTransition();
  const endAnim = object.endAnim ?? defaultTransition();
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
        <button
          className={styles.fullBtn}
          onClick={() => {
            if (corEditId === id) {
              const scene = getR3F()?.scene;
              if (scene) commitCenterOfRotation(id, scene);
              setCorEditId(null);
            } else {
              setCorEditId(id);
            }
          }}
        >
          {corEditId === id
            ? '✓ Set center of rotation'
            : '⊕ Move center of rotation'}
        </button>
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

      {!isGroup && (
        <Section title="Animations">
          <Row label="Idle">
            <select
              className={styles.fullSelect}
              value={idle.type}
              onChange={(e) =>
                setObjectIdle(id, { type: e.target.value as IdleType })
              }
            >
              {IDLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Row>
          {idle.type !== 'none' && (
            <Row label="Speed">
              <Slider
                value={Math.min(1, idle.speed / 4)}
                onChange={(v) => setObjectIdle(id, { speed: v * 4 })}
                display={() => `${idle.speed.toFixed(1)}×`}
              />
            </Row>
          )}
          {idle.type === 'rotate' && (
            <Row label="Axis">
              <select
                className={styles.fullSelect}
                value={idle.axis}
                onChange={(e) =>
                  setObjectIdle(id, { axis: e.target.value as 'x' | 'y' | 'z' })
                }
              >
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
            </Row>
          )}

          <Row label="Start">
            <select
              className={styles.fullSelect}
              value={startAnim.type}
              onChange={(e) =>
                setObjectTransition(id, 'start', {
                  type: e.target.value as TransitionType,
                })
              }
            >
              {TRANSITION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Row>
          {startAnim.type !== 'none' && (
            <Row label="In time">
              <NumberField
                value={startAnim.durationMs / 1000}
                suffix="s"
                onCommit={(v) =>
                  setObjectTransition(id, 'start', { durationMs: v * 1000 })
                }
              />
            </Row>
          )}

          <Row label="End">
            <select
              className={styles.fullSelect}
              value={endAnim.type}
              onChange={(e) =>
                setObjectTransition(id, 'end', {
                  type: e.target.value as TransitionType,
                })
              }
            >
              {TRANSITION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Row>
          {endAnim.type !== 'none' && (
            <Row label="Out time">
              <NumberField
                value={endAnim.durationMs / 1000}
                suffix="s"
                onCommit={(v) =>
                  setObjectTransition(id, 'end', { durationMs: v * 1000 })
                }
              />
            </Row>
          )}
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

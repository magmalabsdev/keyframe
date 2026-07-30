import { useRef } from 'react';
import { useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { evaluateObject } from '../../animation/evaluate';
import { applyTransformEdit, applyColorEdit } from '../../animation/transformEdit';
import {
  defaultIdle,
  defaultTransition,
  isFormTransition,
  type IdleType,
  type SceneObject,
  type TextureMode,
  type TransitionType,
} from '../../state/types';
import { commitCenterOfRotation } from '../../viewport/PivotHandle';
import { getR3F } from '../../render/renderApi';
import { getMediaUrl } from '../../io/mediaCache';
import { importMediaFile } from '../../io/importMedia';
import { ColorField, NumberField, Row, Section, Slider, Vec3Field } from './fields';
import styles from './inspector.module.css';

const IDLE_TYPES: IdleType[] = ['none', 'rotate', 'flicker', 'pulse', 'wiggle'];
const TRANSITION_TYPES: TransitionType[] = [
  'none',
  'pop',
  'fade',
  'digital',
  'flicker',
  'voxel form',
  'particle form',
  'polygon form',
];

export function ObjectInspector({ object }: { object: SceneObject }) {
  const setObjectName = useDocumentStore((s) => s.setObjectName);
  const setObjectVisible = useDocumentStore((s) => s.setObjectVisible);
  const setMaterial = useDocumentStore((s) => s.setObjectMaterial);
  const setChannelKeyframeValue = useDocumentStore((s) => s.setChannelKeyframeValue);
  const setObjectIdle = useDocumentStore((s) => s.setObjectIdle);
  const setObjectTransition = useDocumentStore((s) => s.setObjectTransition);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const corEditId = useEditorStore((s) => s.corEditId);
  const setCorEditId = useEditorStore((s) => s.setCorEditId);
  const textureMedia = useDocumentStore((s) =>
    object.material.textureAssetId ? s.project.media[object.material.textureAssetId] : undefined,
  );
  const textureInput = useRef<HTMLInputElement>(null);

  const { id, material } = object;
  const idle = object.idle ?? defaultIdle();
  const startAnim = object.startAnim ?? defaultTransition();
  const endAnim = object.endAnim ?? defaultTransition();
  // Show the pose at the current playhead so edits reflect (and update) keyframes.
  const t = evaluateObject(object, playheadMs);
  const animated = Object.keys(object.tracks).length > 0;
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
            bindKeyBase={`object:${id}:position`}
            keyframeKeyBase={`object:${id}:position`}
            onCommit={(v) =>
              applyTransformEdit(id, { position: v, rotation: t.rotation, scale: t.scale })
            }
          />
        </Row>
        <Row label="Rotation">
          <Vec3Field
            value={t.rotation}
            suffix="°"
            bindKeyBase={`object:${id}:rotation`}
            keyframeKeyBase={`object:${id}:rotation`}
            onCommit={(v) =>
              applyTransformEdit(id, { position: t.position, rotation: v, scale: t.scale })
            }
          />
        </Row>
        <Row label="Scale">
          <Vec3Field
            value={t.scale}
            bindKeyBase={`object:${id}:scale`}
            keyframeKeyBase={`object:${id}:scale`}
            onCommit={(v) =>
              applyTransformEdit(id, { position: t.position, rotation: t.rotation, scale: v })
            }
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
              value={t.color}
              onChange={(c) => applyColorEdit(id, c)}
              keyframeKey={`object:${id}:color`}
            />
          </Row>
          <Row label="Opacity">
            <Slider
              value={t.opacity}
              keyframeKey={`object:${id}:opacity`}
              onChange={(v) => {
                if ((object.tracks.opacity?.length ?? 0) > 0)
                  setChannelKeyframeValue(`object:${id}:opacity`, playheadMs, v);
                else setMaterial(id, { opacity: v });
              }}
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
          <Row label="Texture">
            {textureMedia ? (
              <div className={styles.texturePreview}>
                <img src={getMediaUrl(textureMedia.id)} alt={textureMedia.name} />
                <button onClick={() => setMaterial(id, { textureAssetId: undefined })}>
                  Remove
                </button>
              </div>
            ) : (
              <button onClick={() => textureInput.current?.click()}>Upload image</button>
            )}
            <input
              ref={textureInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void importMediaFile(file, 'image').then((mediaId) =>
                    setMaterial(id, { textureAssetId: mediaId }),
                  );
                }
                e.target.value = '';
              }}
            />
          </Row>
          {textureMedia && (
            <>
              <Row label="Mapping">
                <select
                  className={styles.fullSelect}
                  value={material.textureMode ?? 'fill'}
                  onChange={(e) =>
                    setMaterial(id, { textureMode: e.target.value as TextureMode })
                  }
                >
                  <option value="fill">Fill</option>
                  <option value="tile">Tile</option>
                </select>
              </Row>
              {(material.textureMode ?? 'fill') === 'tile' && (
                <Row label="Tile size">
                  <NumberField
                    value={material.textureScale ?? 100}
                    suffix="mm"
                    onCommit={(v) => setMaterial(id, { textureScale: Math.max(1, v) })}
                  />
                </Row>
              )}
            </>
          )}
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
          {isFormTransition(startAnim.type) && (
            <>
              <Row label="Density">
                <Slider
                  value={startAnim.density ?? 0.5}
                  onChange={(v) => setObjectTransition(id, 'start', { density: v })}
                  display={(v) => `${Math.round(v * 100)}%`}
                />
              </Row>
              {startAnim.type !== 'polygon form' && (
                <Row label="Solid fill">
                  <input
                    type="checkbox"
                    checked={startAnim.solidFill ?? false}
                    onChange={(e) =>
                      setObjectTransition(id, 'start', { solidFill: e.target.checked })
                    }
                  />
                </Row>
              )}
            </>
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
          {isFormTransition(endAnim.type) && (
            <>
              <Row label="Density">
                <Slider
                  value={endAnim.density ?? 0.5}
                  onChange={(v) => setObjectTransition(id, 'end', { density: v })}
                  display={(v) => `${Math.round(v * 100)}%`}
                />
              </Row>
              {endAnim.type !== 'polygon form' && (
                <Row label="Solid fill">
                  <input
                    type="checkbox"
                    checked={endAnim.solidFill ?? false}
                    onChange={(e) =>
                      setObjectTransition(id, 'end', { solidFill: e.target.checked })
                    }
                  />
                </Row>
              )}
            </>
          )}
        </Section>
      )}

    </div>
  );
}

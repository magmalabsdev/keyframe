import { useRef } from 'react';
import { getActiveScene, useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { evaluateObject, type LightValues } from '../../animation/evaluate';
import { applyTransformEdit, applyColorEdit, applyLightEdit } from '../../animation/transformEdit';
import { localFromWorldTransform, worldTransformOf } from '../../animation/worldTransform';
import {
  DEFAULT_SURFACE_H,
  DEFAULT_SURFACE_W,
  defaultLightParams,
  defaultSurfaceParams,
  defaultTextParams,
  rectPoints,
} from '../../state/defaults';
import { planTextEdit } from '../../scene/textLayout';
import { loadThreeFont } from '../../io/fonts';
import { FontPicker } from './FontPicker';
import { ObjectTypeIcon } from '../ObjectTypeIcon';
import { polygonBounds } from '../../scene/surfaceGeometry';
import {
  defaultIdle,
  defaultTransition,
  isFormTransition,
  type IdleType,
  type Point2,
  type SceneObject,
  type SurfaceAlign,
  type SurfaceContent,
  type SurfaceFit,
  type TextParams,
  type VerticalTextAlign,
  type TextureMode,
  type TransitionType,
} from '../../state/types';
import { commitCenterOfRotation } from '../../viewport/PivotHandle';
import { getR3F } from '../../render/renderApi';
import { getMediaUrl } from '../../io/mediaCache';
import { importMediaFile } from '../../io/importMedia';
import {
  ColorField,
  NumberField,
  Row,
  Section,
  Slider,
  TextField,
  Vec3Field,
} from './fields';
import styles from './inspector.module.css';

/** Light emission fields (shared by light objects and emitter meshes). All
 *  channels are keyframable; values shown are evaluated at the playhead. */
function LightFields({ id, lv }: { id: string; lv: LightValues }) {
  return (
    <>
      <Row label="Color">
        <ColorField
          value={lv.color}
          onChange={(c) => applyLightEdit(id, { color: c })}
          keyframeKey={`object:${id}:light.color`}
        />
      </Row>
      <Row label="Intensity">
        <Slider
          value={lv.intensity / 10}
          keyframeKey={`object:${id}:light.intensity`}
          onChange={(v) => applyLightEdit(id, { intensity: v * 10 })}
          display={() => lv.intensity.toFixed(1)}
        />
      </Row>
      <Row label="Spread">
        <NumberField
          value={lv.spreadDeg}
          suffix="°"
          keyframeKey={`object:${id}:light.spread`}
          onCommit={(v) =>
            applyLightEdit(id, { spreadDeg: Math.max(1, Math.min(360, v)) })
          }
        />
      </Row>
      <Row label="Softness">
        <Slider
          value={lv.softness}
          keyframeKey={`object:${id}:light.softness`}
          onChange={(v) => applyLightEdit(id, { softness: v })}
        />
      </Row>
      <Row label="Direction">
        <Vec3Field
          value={lv.direction}
          keyframeKeyBase={`object:${id}:light.direction`}
          onCommit={(v) => applyLightEdit(id, { direction: v })}
        />
      </Row>
      <div className={styles.hint}>Spread over 180° shines in all directions</div>
    </>
  );
}

const SHAPE_PRESETS: { label: string; sides: number }[] = [
  { label: 'Rect', sides: 4 },
  { label: 'Triangle', sides: 3 },
  { label: 'Hexagon', sides: 6 },
  { label: 'Circle', sides: 32 },
];

/** Regular n-gon inscribed in the current polygon's bounding box. */
function regularPolygon(sides: number, width: number, height: number): Point2[] {
  if (sides === 4) return rectPoints(width, height);
  const points: Point2[] = [];
  // Start at the top so triangles and hexagons land in their familiar pose.
  for (let i = 0; i < sides; i++) {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push([(Math.cos(angle) * width) / 2, (Math.sin(angle) * height) / 2]);
  }
  return points;
}

/**
 * Content, styling, and polygon shape for a flat surface. Color and opacity
 * live on `material` (not on SurfaceParams) so they animate through the
 * existing color/opacity channels — for a text surface they are the text's.
 */
function SurfaceFields({
  object,
  color,
  opacity,
  playheadMs,
}: {
  object: SceneObject;
  color: string;
  opacity: number;
  playheadMs: number;
}) {
  const setSurface = useDocumentStore((s) => s.setObjectSurface);
  const setMaterial = useDocumentStore((s) => s.setObjectMaterial);
  const setChannelKeyframeValue = useDocumentStore((s) => s.setChannelKeyframeValue);
  const media = useDocumentStore((s) =>
    object.surface?.mediaId ? s.project.media[object.surface.mediaId] : undefined,
  );
  const surfaceEditId = useEditorStore((s) => s.surfaceEditId);
  const setSurfaceEditId = useEditorStore((s) => s.setSurfaceEditId);
  const mediaInput = useRef<HTMLInputElement>(null);

  const { id } = object;
  const surface = object.surface ?? defaultSurfaceParams();
  const isText = surface.content === 'text';
  const editing = surfaceEditId === id;
  const bounds = polygonBounds(surface.points);
  const showBackground = surface.showBackground ?? !isText;

  return (
    <Section title="Surface">
      <Row label="Content">
        <select
          className={styles.fullSelect}
          value={surface.content}
          onChange={(e) => {
            const content = e.target.value as SurfaceContent;
            setSurface(id, {
              content,
              // Media picked for one mode would be the wrong kind for the other.
              mediaId: content === 'text' ? surface.mediaId : undefined,
              showBackground: content !== 'text',
            });
          }}
        >
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="text">Text</option>
        </select>
      </Row>

      {!isText && (
        <>
          <Row label={surface.content === 'video' ? 'Video' : 'Image'}>
            {media ? (
              <div className={styles.texturePreview}>
                {media.kind === 'video' ? (
                  <video src={getMediaUrl(media.id)} muted />
                ) : (
                  <img src={getMediaUrl(media.id)} alt={media.name} />
                )}
                <button onClick={() => setSurface(id, { mediaId: undefined })}>
                  Remove
                </button>
              </div>
            ) : (
              <button onClick={() => mediaInput.current?.click()}>
                Upload {surface.content}
              </button>
            )}
            <input
              ref={mediaInput}
              type="file"
              accept={surface.content === 'video' ? 'video/*' : 'image/*'}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void importMediaFile(
                    file,
                    surface.content === 'video' ? 'video' : 'image',
                  ).then((mediaId) => setSurface(id, { mediaId }));
                }
                e.target.value = '';
              }}
            />
          </Row>
          {media && (
            <Row label="Fit">
              <select
                className={styles.fullSelect}
                value={surface.fit ?? 'stretch'}
                onChange={(e) => setSurface(id, { fit: e.target.value as SurfaceFit })}
              >
                <option value="stretch">Stretch</option>
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
              </select>
            </Row>
          )}
        </>
      )}

      {isText && (
        <>
          <Row label="Text">
            <TextField
              value={surface.text ?? ''}
              multiline
              onCommit={(v) => setSurface(id, { text: v })}
            />
          </Row>
          <Row label="Font">
            <FontPicker
              value={surface.fontId}
              onChange={(fontId) => setSurface(id, { fontId })}
            />
          </Row>
          <Row label="Size">
            <NumberField
              value={surface.fontSize ?? 40}
              suffix="mm"
              onCommit={(v) => setSurface(id, { fontSize: Math.max(1, v) })}
            />
          </Row>
          <Row label="Align">
            <select
              className={styles.fullSelect}
              value={surface.align ?? 'center'}
              onChange={(e) => setSurface(id, { align: e.target.value as SurfaceAlign })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Row>
          <Row label="Tracking">
            <NumberField
              value={surface.letterSpacing ?? 0}
              suffix="em"
              onCommit={(v) => setSurface(id, { letterSpacing: v })}
            />
          </Row>
          <Row label="Line height">
            <NumberField
              value={surface.lineHeight ?? 1.15}
              onCommit={(v) => setSurface(id, { lineHeight: Math.max(0.1, v) })}
            />
          </Row>
          <Row label="Write-on">
            <Slider
              value={evaluateObject(object, playheadMs).writeOn ?? 1}
              keyframeKey={`object:${id}:text.writeOn`}
              onChange={(v) => {
                if ((object.tracks['text.writeOn']?.length ?? 0) > 0)
                  setChannelKeyframeValue(`object:${id}:text.writeOn`, playheadMs, v);
                else setSurface(id, { writeOn: v });
              }}
              display={(v) => `${Math.round(v * 100)}%`}
            />
          </Row>
          <Row label="Backdrop">
            <input
              type="checkbox"
              checked={showBackground}
              onChange={(e) => setSurface(id, { showBackground: e.target.checked })}
            />
          </Row>
          {showBackground && (
            <Row label="Backdrop color">
              <ColorField
                value={surface.backgroundColor ?? '#000000'}
                onChange={(c) => setSurface(id, { backgroundColor: c })}
              />
            </Row>
          )}
        </>
      )}

      <Row label={isText ? 'Text color' : 'Tint'}>
        <ColorField
          value={color}
          onChange={(c) => applyColorEdit(id, c)}
          keyframeKey={`object:${id}:color`}
        />
      </Row>
      <Row label="Opacity">
        <Slider
          value={opacity}
          keyframeKey={`object:${id}:opacity`}
          onChange={(v) => {
            if ((object.tracks.opacity?.length ?? 0) > 0)
              setChannelKeyframeValue(`object:${id}:opacity`, playheadMs, v);
            else setMaterial(id, { opacity: v });
          }}
          display={(v) => `${Math.round(v * 100)}%`}
        />
      </Row>
      <Row label="Double-sided">
        <input
          type="checkbox"
          checked={surface.doubleSided ?? true}
          onChange={(e) => setSurface(id, { doubleSided: e.target.checked })}
        />
      </Row>

      <Row label="Shape">
        <div className={styles.kfChips}>
          {SHAPE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={styles.kfChip}
              onClick={() =>
                setSurface(id, {
                  points: regularPolygon(
                    preset.sides,
                    bounds.w || DEFAULT_SURFACE_W,
                    bounds.h || DEFAULT_SURFACE_H,
                  ),
                })
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Size">
        <div className={styles.vec3}>
          <NumberField
            value={bounds.w}
            suffix="mm"
            onCommit={(v) =>
              setSurface(id, { points: scalePolygon(surface.points, Math.max(1, v), bounds.h) })
            }
          />
          <NumberField
            value={bounds.h}
            suffix="mm"
            onCommit={(v) =>
              setSurface(id, { points: scalePolygon(surface.points, bounds.w, Math.max(1, v)) })
            }
          />
        </div>
      </Row>
      <button
        className={styles.fullBtn}
        onClick={() => setSurfaceEditId(editing ? null : id)}
      >
        {editing ? '✓ Done editing points' : '◇ Edit points'}
      </button>
      {editing && (
        <>
          <div className={styles.hint}>
            Drag a corner to move it, click a green midpoint to add one, alt-click
            a corner to remove it.
          </div>
          {surface.points.map((p, i) => (
            <Row key={i} label={`P${i}`}>
              <div className={styles.vec3}>
                <NumberField
                  value={p[0]}
                  suffix="mm"
                  onCommit={(v) => setSurface(id, { points: setPoint(surface.points, i, [v, p[1]]) })}
                />
                <NumberField
                  value={p[1]}
                  suffix="mm"
                  onCommit={(v) => setSurface(id, { points: setPoint(surface.points, i, [p[0], v]) })}
                />
                <button
                  className={styles.smallBtn}
                  disabled={surface.points.length <= 3}
                  title={
                    surface.points.length <= 3
                      ? 'A polygon needs at least 3 points'
                      : 'Remove point'
                  }
                  onClick={() =>
                    setSurface(id, { points: surface.points.filter((_, j) => j !== i) })
                  }
                >
                  ×
                </button>
              </div>
            </Row>
          ))}
        </>
      )}
    </Section>
  );
}

/**
 * Content + styling for a 3D text object. Layout-affecting edits go through
 * planTextEdit/applyTextEdit so glyph children reconcile (and destructive
 * edits confirm first); material edits propagate to un-customized glyphs.
 */
function TextFields({
  object,
  writeOn,
  playheadMs,
}: {
  object: SceneObject;
  writeOn: number;
  playheadMs: number;
}) {
  const setObjectText = useDocumentStore((s) => s.setObjectText);
  const applyEdit = useDocumentStore((s) => s.applyTextEdit);
  const setTextMaterial = useDocumentStore((s) => s.setTextMaterial);
  const setChannelKeyframeValue = useDocumentStore((s) => s.setChannelKeyframeValue);

  const { id, material } = object;
  const text = object.text ?? defaultTextParams();

  /** Re-layout edit: diff children, confirm if customized glyphs would die. */
  const commit = (patch: Partial<TextParams>) => {
    const params = { ...text, ...patch };
    void loadThreeFont(params.fontId).then((font) => {
      const objects = getActiveScene(useDocumentStore.getState().project).objects;
      const parent = objects.find((o) => o.id === id) ?? object;
      const glyphs = objects.filter((o) => o.parentId === id && o.type === 'glyph');
      const plan = planTextEdit(parent, glyphs, params, font);
      if (plan.removedCustomized.length > 0) {
        const chars = plan.removedCustomized
          .slice(0, 6)
          .map((c) => `'${c.char}'`)
          .join(', ');
        const more = plan.removedCustomized.length > 6 ? ', …' : '';
        const ok = confirm(
          `This edit deletes ${plan.removedCustomized.length} customized character(s) ` +
            `(${chars}${more}) along with their keyframes and styling. Continue?`,
        );
        if (!ok) return;
      }
      applyEdit(id, plan);
    });
  };

  return (
    <Section title="Text">
      <Row label="Text">
        <TextField value={text.text} multiline onCommit={(v) => commit({ text: v })} />
      </Row>
      <Row label="Font">
        <FontPicker value={text.fontId} onChange={(fontId) => commit({ fontId })} />
      </Row>
      <Row label="Size">
        <NumberField
          value={text.fontSize}
          suffix="mm"
          onCommit={(v) => commit({ fontSize: Math.max(1, v) })}
        />
      </Row>
      <Row label="Depth">
        <NumberField
          value={text.depth}
          suffix="mm"
          onCommit={(v) => commit({ depth: Math.max(0.1, v) })}
        />
      </Row>
      <Row label="Horizontal align">
        <select
          className={styles.fullSelect}
          value={text.align}
          onChange={(e) => commit({ align: e.target.value as SurfaceAlign })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </Row>
      <Row label="Vertical align">
        <select
          className={styles.fullSelect}
          value={text.vAlign ?? 'center'}
          onChange={(e) => commit({ vAlign: e.target.value as VerticalTextAlign })}
        >
          <option value="top">Top</option>
          <option value="center">Center</option>
          <option value="bottom">Bottom</option>
        </select>
      </Row>
      <Row label="Tracking">
        <NumberField
          value={text.letterSpacing}
          suffix="em"
          onCommit={(v) => commit({ letterSpacing: v })}
        />
      </Row>
      <Row label="Line height">
        <NumberField
          value={text.lineHeight}
          onCommit={(v) => commit({ lineHeight: Math.max(0.1, v) })}
        />
      </Row>

      {/* Parent material edits cascade to glyphs that still match the parent;
          individually styled characters keep their look (edit them directly). */}
      <Row label="Color">
        <ColorField value={material.color} onChange={(c) => setTextMaterial(id, { color: c })} />
      </Row>
      <Row label="Opacity">
        <Slider
          value={material.opacity}
          onChange={(v) => setTextMaterial(id, { opacity: v })}
          display={(v) => `${Math.round(v * 100)}%`}
        />
      </Row>
      <Row label="Reflect">
        <Slider
          value={material.metalness}
          onChange={(v) => setTextMaterial(id, { metalness: v })}
        />
      </Row>
      <Row label="Rough">
        <Slider
          value={material.roughness}
          onChange={(v) => setTextMaterial(id, { roughness: v })}
        />
      </Row>

      <Row label="Write-on">
        <Slider
          value={writeOn}
          keyframeKey={`object:${id}:text.writeOn`}
          onChange={(v) => {
            if ((object.tracks['text.writeOn']?.length ?? 0) > 0)
              setChannelKeyframeValue(`object:${id}:text.writeOn`, playheadMs, v);
            else setObjectText(id, { writeOn: v });
          }}
          display={(v) => `${Math.round(v * 100)}%`}
        />
      </Row>
      <div className={styles.hint}>
        Each character is a sub-object: select one to keyframe or restyle it.
      </div>
    </Section>
  );
}

/** Replaces one point, returning a new list. */
function setPoint(points: Point2[], index: number, value: Point2): Point2[] {
  const next = points.map((p) => [...p] as Point2);
  next[index] = value;
  return next;
}

/** Rescales a polygon about its bbox center to the given dimensions. */
function scalePolygon(points: Point2[], width: number, height: number): Point2[] {
  const b = polygonBounds(points);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const sx = b.w > 1e-6 ? width / b.w : 1;
  const sy = b.h > 1e-6 ? height / b.h : 1;
  return points.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy] as Point2);
}

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
  const setObjectLight = useDocumentStore((s) => s.setObjectLight);
  const setChannelKeyframeValue = useDocumentStore((s) => s.setChannelKeyframeValue);
  const setObjectIdle = useDocumentStore((s) => s.setObjectIdle);
  const setObjectTransition = useDocumentStore((s) => s.setObjectTransition);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const corEditId = useEditorStore((s) => s.corEditId);
  const setCorEditId = useEditorStore((s) => s.setCorEditId);
  const transformSpace = useEditorStore((s) => s.transformSpace);
  const setTransformSpace = useEditorStore((s) => s.setTransformSpace);
  const textureMedia = useDocumentStore((s) =>
    object.material.textureAssetId ? s.project.media[object.material.textureAssetId] : undefined,
  );
  const assets = useDocumentStore((s) => s.project.assets);
  const activeScene = useDocumentStore((s) => getActiveScene(s.project));
  // Only a glyph needs its parent (to read the text's chosen font for its icon).
  const parentObject = useDocumentStore((s) =>
    object.type === 'glyph' && object.parentId
      ? getActiveScene(s.project).objects.find((o) => o.id === object.parentId)
      : undefined,
  );
  const textureInput = useRef<HTMLInputElement>(null);

  const { id, material } = object;
  const idle = object.idle ?? defaultIdle();
  const startAnim = object.startAnim ?? defaultTransition();
  const endAnim = object.endAnim ?? defaultTransition();
  // Show the pose at the current playhead so edits reflect (and update) keyframes.
  const t = evaluateObject(object, playheadMs);
  // Absolute mode shows/edits world-space Position & Rotation instead of the
  // stored parent-local values. Composed from the document (each ancestor's own
  // keyframe-evaluated transform), not the live scene graph, so idle animations
  // (rotate/pulse/wiggle) don't make the numbers jitter while nothing is edited.
  const worldT =
    transformSpace === 'absolute' ? worldTransformOf(activeScene, id, playheadMs) : null;
  const posValue = worldT?.position ?? t.position;
  const rotValue = worldT?.rotation ?? t.rotation;
  const animated = Object.keys(object.tracks).length > 0;
  const isGroup = object.type === 'group';
  const isLight = object.type === 'light';
  const isSurface = object.type === 'surface';
  const isText = object.type === 'text';
  const isGlyph = object.type === 'glyph';
  const isMesh = !isGroup && !isLight && !isSurface && !isText && !isGlyph;
  // Form transitions fragment real triangles. Text surfaces are the one
  // exclusion: troika's geometry is instanced SDF quads and their backdrop is
  // hidden by default, so fragmenting one would just make the text vanish —
  // 3D text objects fragment through their glyphs' extruded geometry instead.
  const isTextSurface = isSurface && object.surface?.content === 'text';
  const transitionTypes = isTextSurface
    ? TRANSITION_TYPES.filter((t) => !isFormTransition(t))
    : TRANSITION_TYPES;
  const emitting = object.light?.enabled === true;
  const lightValues = t.light ?? defaultLightParams();

  return (
    <div className={styles.inspector}>
      <div className={styles.titleRow}>
        <span className={styles.typeIcon}>
          <ObjectTypeIcon object={object} assets={assets} parent={parentObject} />
        </span>
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
        <Row label="Gizmo axes">
          <div className={styles.modeToggle}>
            <button
              className={`${styles.smallBtn} ${transformSpace === 'relative' ? 'primary' : ''}`}
              onClick={() => setTransformSpace('relative')}
              title="Move/rotate handles align to this object's own axes; Position/Rotation below show local values"
            >
              Relative
            </button>
            <button
              className={`${styles.smallBtn} ${transformSpace === 'absolute' ? 'primary' : ''}`}
              onClick={() => setTransformSpace('absolute')}
              title="Move/rotate handles align to world axes; Position/Rotation below show world values"
            >
              Absolute
            </button>
          </div>
        </Row>
        <Row label="Position">
          <Vec3Field
            value={posValue}
            suffix="mm"
            bindKeyBase={`object:${id}:position`}
            keyframeKeyBase={`object:${id}:position`}
            onCommit={(v) => {
              // The scale plugged in here is only scaffolding for the matrix
              // round-trip (paired with worldT's own decomposed scale so it's
              // internally consistent); the final commit below always keeps
              // the object's real local scale unchanged.
              const local = worldT
                ? localFromWorldTransform(activeScene, id, playheadMs, {
                    position: v,
                    rotation: rotValue,
                    scale: worldT.scale,
                  })
                : { position: v, rotation: t.rotation, scale: t.scale };
              applyTransformEdit(id, { position: local.position, rotation: local.rotation, scale: t.scale });
            }}
          />
        </Row>
        <Row label="Rotation">
          <Vec3Field
            value={rotValue}
            suffix="°"
            bindKeyBase={`object:${id}:rotation`}
            keyframeKeyBase={`object:${id}:rotation`}
            onCommit={(v) => {
              const local = worldT
                ? localFromWorldTransform(activeScene, id, playheadMs, {
                    position: posValue,
                    rotation: v,
                    scale: worldT.scale,
                  })
                : { position: t.position, rotation: v, scale: t.scale };
              applyTransformEdit(id, { position: local.position, rotation: local.rotation, scale: t.scale });
            }}
          />
        </Row>
        {!isLight && (
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
        )}
        {!isLight && (
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
        )}
      </Section>

      {isLight && (
        <Section title="Light">
          <LightFields id={id} lv={lightValues} />
        </Section>
      )}

      {isMesh && (
        <Section title="Light">
          <Row label="Emit light">
            <input
              type="checkbox"
              checked={emitting}
              onChange={(e) => setObjectLight(id, { enabled: e.target.checked })}
            />
          </Row>
          {emitting && <LightFields id={id} lv={lightValues} />}
        </Section>
      )}

      {isSurface && (
        <SurfaceFields
          object={object}
          color={t.color}
          opacity={t.opacity}
          playheadMs={playheadMs}
        />
      )}

      {isText && (
        <TextFields object={object} writeOn={t.writeOn ?? 1} playheadMs={playheadMs} />
      )}

      {isGlyph && (
        <Section title="Character">
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
          <div className={styles.hint}>
            Edits here override the text's defaults for this character.
          </div>
        </Section>
      )}

      {isMesh && (
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

      {(isMesh || isSurface || isText || isGlyph) && (
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
              {transitionTypes.map((t) => (
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
              {transitionTypes.map((t) => (
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

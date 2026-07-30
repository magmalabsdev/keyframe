import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import type { SceneObject } from '../../state/types';
import { ColorField, NumberField, Row, Section, Slider } from './fields';
import styles from './inspector.module.css';

type Field = 'position' | 'rotation' | 'scale';
const AXES: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];

function allSame<T>(values: T[]): boolean {
  return values.every((v) => v === values[0]);
}

function MultiVec3({
  objects,
  field,
  suffix,
  onSet,
}: {
  objects: SceneObject[];
  field: Field;
  suffix?: string;
  onSet: (axis: 0 | 1 | 2, value: number) => void;
}) {
  return (
    <div className={styles.vec3}>
      {AXES.map((a, i) => {
        const vals = objects.map((o) => o.transform[field][i]);
        const mixed = !allSame(vals);
        return (
          <NumberField
            key={a}
            axis={a}
            suffix={suffix}
            mixed={mixed}
            value={vals[0]}
            onCommit={(v) => onSet(i as 0 | 1 | 2, v)}
          />
        );
      })}
    </div>
  );
}

/** Inspector for an ad-hoc multi-selection: shared values show normally, others
 * show MIXED; edits apply to all selected objects in one undo step. */
export function MultiObjectInspector({ ids }: { ids: string[] }) {
  const objects = useActiveScene().objects.filter((o) => ids.includes(o.id));
  const setComponent = useDocumentStore((s) => s.setObjectsTransformComponent);
  const setMaterial = useDocumentStore((s) => s.setObjectsMaterial);
  const setVisible = useDocumentStore((s) => s.setObjectsVisible);

  if (objects.length === 0) return null;

  const colors = objects.map((o) => o.material.color);
  const opacities = objects.map((o) => o.material.opacity);
  const metalness = objects.map((o) => o.material.metalness);
  const roughness = objects.map((o) => o.material.roughness);
  const allVisible = objects.every((o) => o.visible);
  // Surfaces and glyphs carry the same color/opacity material fields as meshes.
  const meshes = objects.filter(
    (o) => o.type === 'mesh' || o.type === 'surface' || o.type === 'glyph',
  );

  return (
    <div className={styles.inspector}>
      <div className={styles.titleRow}>
        <input value={`${objects.length} objects`} readOnly />
        <button
          style={{ width: 'auto' }}
          onClick={() => setVisible(ids, !allVisible)}
          title={allVisible ? 'Hide all' : 'Show all'}
        >
          {allVisible ? '◉' : '○'}
        </button>
      </div>

      <Section title="Transform">
        <Row label="Position">
          <MultiVec3
            objects={objects}
            field="position"
            suffix="mm"
            onSet={(axis, v) => setComponent(ids, 'position', axis, v)}
          />
        </Row>
        <Row label="Rotation">
          <MultiVec3
            objects={objects}
            field="rotation"
            suffix="°"
            onSet={(axis, v) => setComponent(ids, 'rotation', axis, v)}
          />
        </Row>
        <Row label="Scale">
          <MultiVec3
            objects={objects}
            field="scale"
            onSet={(axis, v) => setComponent(ids, 'scale', axis, v)}
          />
        </Row>
      </Section>

      {meshes.length > 0 && (
        <Section title="Material">
          <Row label="Color">
            <ColorField
              value={colors[0]}
              mixed={!allSame(colors)}
              onChange={(c) => setMaterial(ids, { color: c })}
            />
          </Row>
          <Row label="Opacity">
            <Slider
              value={opacities[0]}
              mixed={!allSame(opacities)}
              onChange={(v) => setMaterial(ids, { opacity: v })}
              display={(v) => `${Math.round(v * 100)}%`}
            />
          </Row>
          <Row label="Reflect">
            <Slider
              value={metalness[0]}
              mixed={!allSame(metalness)}
              onChange={(v) => setMaterial(ids, { metalness: v })}
            />
          </Row>
          <Row label="Rough">
            <Slider
              value={roughness[0]}
              mixed={!allSame(roughness)}
              onChange={(v) => setMaterial(ids, { roughness: v })}
            />
          </Row>
        </Section>
      )}

      <div className={styles.empty}>
        <p className={styles.hint}>
          Editing a field applies to all {objects.length} selected objects. Press
          ⌘G to group them.
        </p>
      </div>
    </div>
  );
}

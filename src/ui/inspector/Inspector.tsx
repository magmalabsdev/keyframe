import { useActiveScene } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { ObjectInspector } from './ObjectInspector';
import { MultiObjectInspector } from './MultiObjectInspector';
import { SceneInspector } from './SceneInspector';

export function Inspector() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const objects = useActiveScene().objects;

  if (selectedIds.length === 1) {
    const obj = objects.find((o) => o.id === selectedIds[0]);
    if (obj) return <ObjectInspector object={obj} />;
  }

  if (selectedIds.length > 1) {
    return <MultiObjectInspector ids={selectedIds} />;
  }

  return <SceneInspector />;
}

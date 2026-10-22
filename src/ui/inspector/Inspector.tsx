import { useActiveScene } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { ObjectInspector } from './ObjectInspector';
import { MultiObjectInspector } from './MultiObjectInspector';
import { AudioInspector } from './AudioInspector';
import { CameraInspector } from './CameraInspector';
import { SceneInspector } from './SceneInspector';

export function Inspector() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);
  const cameraSelected = useEditorStore((s) => s.cameraSelected);
  const scene = useActiveScene();

  if (cameraSelected) return <CameraInspector />;

  if (selectedAudioClipId) {
    for (const track of scene.audioTracks ?? []) {
      const clip = track.clips.find((c) => c.id === selectedAudioClipId);
      if (clip) return <AudioInspector track={track} clip={clip} />;
    }
  }

  if (selectedIds.length === 1) {
    const obj = scene.objects.find((o) => o.id === selectedIds[0]);
    if (obj) return <ObjectInspector object={obj} />;
  }

  if (selectedIds.length > 1) {
    return <MultiObjectInspector ids={selectedIds} />;
  }

  return <SceneInspector />;
}

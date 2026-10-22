import { useActiveScene, useDocumentStore } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { evaluateTrack } from '../../animation/evaluate';
import type { AudioClip, AudioTrack } from '../../state/types';
import { Row, Section, Slider } from './fields';
import styles from './inspector.module.css';

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Inspector for the selected audio clip — currently just its keyframable
 * volume, plus a couple of read-only/simple fields. Mirrors ObjectInspector's
 * title row + Section/Row layout. */
export function AudioInspector({ track, clip }: { track: AudioTrack; clip: AudioClip }) {
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const setSelectedAudioClip = useEditorStore((s) => s.setSelectedAudioClip);
  const setAudioClipGain = useDocumentStore((s) => s.setAudioClipGain);
  const setChannelKeyframeValue = useDocumentStore((s) => s.setChannelKeyframeValue);
  const setAudioClipLoop = useDocumentStore((s) => s.setAudioClipLoop);
  const removeAudioClip = useDocumentStore((s) => s.removeAudioClip);

  const animated = (clip.gainTrack?.length ?? 0) > 0;
  const gain = evaluateTrack(clip.gainTrack, playheadMs, clip.gain);
  const channelKey = `audioClip:${clip.id}:gain`;

  return (
    <div className={styles.inspector}>
      <div className={styles.titleRow}>
        <span className={styles.typeIcon}>♪</span>
        <span style={{ flex: 1, fontWeight: 600 }} title={clip.name}>
          {clip.name}
        </span>
        <button
          style={{ width: 'auto' }}
          onClick={() => {
            setSelectedAudioClip(null);
            removeAudioClip(track.id, clip.id);
          }}
          title="Remove clip"
        >
          ×
        </button>
      </div>

      <Section title={animated ? 'Volume · at playhead' : 'Volume'}>
        <Row label="Gain">
          <Slider
            value={gain}
            keyframeKey={channelKey}
            onChange={(v) => {
              if (animated) setChannelKeyframeValue(channelKey, playheadMs, v);
              else setAudioClipGain(track.id, clip.id, v);
            }}
            display={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
      </Section>

      <Section title="Clip">
        <Row label="Track">
          <span className={styles.readonlyValue}>{track.name}</span>
        </Row>
        <Row label="Start / length">
          <span className={styles.readonlyValue}>
            {fmtMs(clip.startMs)} / {fmtMs(clip.durationMs)}
          </span>
        </Row>
        <Row label="Loop source">
          <input
            type="checkbox"
            checked={clip.loop}
            onChange={(e) => setAudioClipLoop(track.id, clip.id, e.target.checked)}
          />
        </Row>
      </Section>
    </div>
  );
}

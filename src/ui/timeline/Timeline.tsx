import { useRef } from 'react';
import { useActiveScene, useDocumentStore, useObject } from '../../state/documentStore';
import { useEditorStore } from '../../state/editorStore';
import { keyframeSelection } from '../../animation/transformEdit';
import { applyCameraState, getCameraState } from '../../viewport/cameraApi';
import styles from './timeline.module.css';

function fmt(ms: number): string {
  const s = ms / 1000;
  return `${Math.floor(s)}.${Math.floor((s % 1) * 100)
    .toString()
    .padStart(2, '0')}s`;
}

/** Begins a pointer drag, forwarding moves to onMove with the captured rect. */
function beginDrag(
  rect: DOMRect,
  onMove: (clientX: number) => void,
  onEnd?: () => void,
) {
  const move = (e: PointerEvent) => onMove(e.clientX);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export function Timeline() {
  const scene = useActiveScene();
  const duration = scene.durationMs;

  const playheadMs = useEditorStore((s) => s.playheadMs);
  const playing = useEditorStore((s) => s.playing);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const selectedIds = useEditorStore((s) => s.selectedIds);

  const upsertCameraKeyframe = useDocumentStore((s) => s.upsertCameraKeyframe);
  const moveKeyframesAtTime = useDocumentStore((s) => s.moveKeyframesAtTime);
  const deleteKeyframesAtTime = useDocumentStore((s) => s.deleteKeyframesAtTime);
  const setObjectLifetime = useDocumentStore((s) => s.setObjectLifetime);
  const remapKeyframeTimes = useDocumentStore((s) => s.remapKeyframeTimes);

  const selectedObject = useObject(
    selectedIds.length === 1 ? selectedIds[0] : undefined,
  );

  const tracksRef = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;
  const timeAt = (clientX: number, rect: DOMRect) =>
    Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));

  const scrubFrom = (clientX: number, rect: DOMRect) =>
    setPlayhead(timeAt(clientX, rect));

  const keyCamera = () => {
    const state = getCameraState();
    if (state) upsertCameraKeyframe(playheadMs, state);
  };

  // Ruler ticks roughly every second (capped so we don't draw hundreds).
  const tickStep = Math.max(1000, Math.ceil(duration / 12 / 1000) * 1000);
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickStep) ticks.push(t);

  return (
    <div className={styles.timeline}>
      <div className={styles.transport}>
        <button onClick={() => setPlayhead(0)} title="Go to start">
          ⏮
        </button>
        <button
          className={playing ? 'primary' : ''}
          onClick={() => setPlaying(!playing)}
          title="Play / pause (Space)"
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span className={styles.time}>
          {fmt(playheadMs)} / {fmt(duration)}
        </span>
        <div className={styles.spacer} />
        <button
          onClick={keyframeSelection}
          disabled={selectedIds.length === 0}
          title="Add keyframe at playhead (K)"
        >
          ◆ Key
        </button>
        <button onClick={keyCamera} title="Keyframe the camera at the playhead">
          ◆ Camera
        </button>
      </div>

      <div className={styles.lanes}>
        <div className={styles.labels}>
          <div className={styles.rulerLabel} />
          <div className={styles.laneLabel}>
            {selectedObject ? selectedObject.name : 'Object'}
          </div>
          <div className={styles.laneLabel}>Scene</div>
        </div>

        <div
          className={styles.tracksCol}
          ref={tracksRef}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            scrubFrom(e.clientX, rect);
            beginDrag(rect, (x) => scrubFrom(x, rect));
          }}
        >
          {/* Ruler */}
          <div className={styles.ruler}>
            {ticks.map((t) => (
              <div key={t} className={styles.tick} style={{ left: pct(t) }}>
                <span>{Math.round(t / 1000)}s</span>
              </div>
            ))}
          </div>

          {/* Object lane */}
          <div className={styles.track}>
            {selectedObject ? (
              <ObjectLane
                object={selectedObject}
                duration={duration}
                pct={pct}
                onJump={(t) => setPlayhead(t)}
                onMoveKeyframe={(fromMs, clientX) => {
                  const rect = tracksRef.current!.getBoundingClientRect();
                  return moveKeyframesAtTime(
                    selectedObject.id,
                    fromMs,
                    timeAt(clientX, rect),
                  );
                }}
                onDeleteKeyframe={(timeMs) =>
                  deleteKeyframesAtTime(selectedObject.id, timeMs)
                }
                onLifetime={(life) => setObjectLifetime(selectedObject.id, life)}
                onResizeEnd={(oldLife, scale) => {
                  const obj = useDocumentStore.getState().project.scenes
                    .find((sc) => sc.id === scene.id)
                    ?.objects.find((o) => o.id === selectedObject.id);
                  if (obj) {
                    remapKeyframeTimes(
                      selectedObject.id,
                      oldLife,
                      obj.lifetime,
                      scale ? 'scale' : 'boundary',
                    );
                  }
                }}
                timeAt={timeAt}
                tracksRef={tracksRef}
              />
            ) : (
              <span className={styles.placeholder}>
                Select a single object to edit its timeline
              </span>
            )}
          </div>

          {/* Scene lane (camera keyframes) */}
          <div className={styles.track}>
            <div className={styles.sceneBar} />
            {scene.camera.keyframes.map((k) => (
              <button
                key={k.id}
                className={`${styles.kf} ${styles.camKf}`}
                style={{ left: pct(k.timeMs) }}
                title={`Camera keyframe @ ${fmt(k.timeMs)} — click to jump`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setPlayhead(k.timeMs);
                  applyCameraState(k);
                }}
              />
            ))}
          </div>

          {/* Playhead spanning both lanes */}
          <div
            className={styles.playhead}
            style={{ left: pct(playheadMs) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const rect = tracksRef.current!.getBoundingClientRect();
              beginDrag(rect, (x) => scrubFrom(x, rect));
            }}
          >
            <div className={styles.playheadHandle} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ObjectLane({
  object,
  pct,
  onJump,
  onMoveKeyframe,
  onDeleteKeyframe,
  onLifetime,
  onResizeEnd,
  timeAt,
  tracksRef,
}: {
  object: import('../../state/types').SceneObject;
  duration: number;
  pct: (t: number) => string;
  onJump: (t: number) => void;
  onMoveKeyframe: (fromTimeMs: number, clientX: number) => void;
  onDeleteKeyframe: (timeMs: number) => void;
  onLifetime: (life: { startMs: number; endMs: number }) => void;
  onResizeEnd: (
    oldLife: { startMs: number; endMs: number },
    scale: boolean,
  ) => void;
  timeAt: (clientX: number, rect: DOMRect) => number;
  tracksRef: React.RefObject<HTMLDivElement>;
}) {
  const { startMs, endMs } = object.lifetime;

  const dragHandle = (which: 'start' | 'end' | 'body', e: React.PointerEvent) => {
    e.stopPropagation();
    const rect = tracksRef.current!.getBoundingClientRect();
    const startLife = { ...object.lifetime };
    const grabTime = timeAt(e.clientX, rect);
    const scale = e.shiftKey;
    const move = (clientX: number) => {
      const t = timeAt(clientX, rect);
      if (which === 'start') onLifetime({ startMs: t, endMs: startLife.endMs });
      else if (which === 'end') onLifetime({ startMs: startLife.startMs, endMs: t });
      else {
        const delta = t - grabTime;
        onLifetime({
          startMs: startLife.startMs + delta,
          endMs: startLife.endMs + delta,
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', m);
      window.removeEventListener('pointerup', up);
      // Resizing an end remaps keyframes (move boundary, or scale all with Shift).
      if (which !== 'body') onResizeEnd(startLife, scale);
    };
    const m = (ev: PointerEvent) => move(ev.clientX);
    window.addEventListener('pointermove', m);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div
        className={styles.lifetime}
        style={{ left: pct(startMs), width: `calc(${pct(endMs)} - ${pct(startMs)})` }}
        onPointerDown={(e) => dragHandle('body', e)}
        title="Drag to move lifetime"
      >
        <div
          className={`${styles.lifeHandle} ${styles.left}`}
          onPointerDown={(e) => dragHandle('start', e)}
        />
        <div
          className={`${styles.lifeHandle} ${styles.right}`}
          onPointerDown={(e) => dragHandle('end', e)}
        />
      </div>

      {keyframeTimes(object).map((time) => (
        <button
          key={time}
          className={styles.kf}
          style={{ left: pct(time) }}
          title={`Keyframe @ ${(time / 1000).toFixed(2)}s — click to jump, double-click to delete`}
          onPointerDown={(e) => {
            e.stopPropagation();
            const rect = tracksRef.current!.getBoundingClientRect();
            onJump(time);
            // Track the live position so successive moves chain correctly.
            let cur = time;
            const m = (ev: PointerEvent) => {
              const next = timeAt(ev.clientX, rect);
              onMoveKeyframe(cur, ev.clientX);
              cur = next;
            };
            const up = () => {
              window.removeEventListener('pointermove', m);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', m);
            window.addEventListener('pointerup', up);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onDeleteKeyframe(time);
          }}
        />
      ))}
    </>
  );
}

/** Sorted, de-duplicated times that have at least one keyframe across channels. */
function keyframeTimes(object: import('../../state/types').SceneObject): number[] {
  const set = new Set<number>();
  for (const track of Object.values(object.tracks)) {
    if (track) for (const k of track) set.add(k.timeMs);
  }
  return [...set].sort((a, b) => a - b);
}

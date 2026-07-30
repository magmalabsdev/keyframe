import { useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import {
  getActiveScene,
  useActiveScene,
  useDocumentStore,
} from '../../state/documentStore';
import {
  MAX_PX_PER_MS,
  MIN_PX_PER_MS,
  useEditorStore,
} from '../../state/editorStore';
import { keyframeSelection } from '../../animation/transformEdit';
import {
  applyTimelineSnap,
  keyframeTimes,
  TIMELINE_SNAP_PX,
  type SnapExclude,
} from '../../animation/timeNav';
import { chordFor } from '../../app/keymap';
import { activeFps, goToEnd, goToStart, togglePlayPause, toggleLoop } from '../../app/transport';
import { getCameraState } from '../../viewport/cameraApi';
import { childrenOf } from '../../scene/tree';
import { importAudioFile } from '../../io/importMedia';
import type { AudioClip, AudioTrack, SceneObject } from '../../state/types';
import { clampViewStart, computeZoomViewStart, formatTickLabel, tickStepMs } from './zoomMath';
import { clampDeltaToStart, snapBodyDelta } from './dragSnap';
import { WaveformCanvas } from './WaveformCanvas';
import { buildObjectRows } from './lanePacking';
import styles from './timeline.module.css';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Row height at timelineRowScale === 1; matches the --row-h CSS var below. */
const BASE_ROW_H_PX = 30;

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

type PctFn = (t: number) => string;
type TimeAtFn = (clientX: number, rect: DOMRect) => number;
/** Snaps a time, optionally leaving out the item being dragged. */
type SnapMsFn = (ms: number, exclude?: SnapExclude) => number;

export function Timeline() {
  const scene = useActiveScene();
  const duration = scene.durationMs;
  const audioTracks = scene.audioTracks ?? [];

  const playheadMs = useEditorStore((s) => s.playheadMs);
  const playing = useEditorStore((s) => s.playing);
  const playRate = useEditorStore((s) => s.playRate);
  const loop = useEditorStore((s) => s.loop);
  const inMs = useEditorStore((s) => s.inMs);
  const outMs = useEditorStore((s) => s.outMs);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setInPoint = useEditorStore((s) => s.setInPoint);
  const setOutPoint = useEditorStore((s) => s.setOutPoint);
  const setHelpOpen = useEditorStore((s) => s.setHelpOpen);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const timelineSnap = useEditorStore((s) => s.timelineSnap);
  const setTimelineSnap = useEditorStore((s) => s.setTimelineSnap);
  const timelinePxPerMs = useEditorStore((s) => s.timelinePxPerMs);
  const timelineViewStartMs = useEditorStore((s) => s.timelineViewStartMs);
  const timelineRowScale = useEditorStore((s) => s.timelineRowScale);
  const setTimelineZoom = useEditorStore((s) => s.setTimelineZoom);
  const setTimelineRowScale = useEditorStore((s) => s.setTimelineRowScale);

  const upsertCameraKeyframe = useDocumentStore((s) => s.upsertCameraKeyframe);
  const removeCameraKeyframeAtTime = useDocumentStore((s) => s.removeCameraKeyframeAtTime);
  const addAudioTrack = useDocumentStore((s) => s.addAudioTrack);
  const moveMarker = useDocumentStore((s) => s.moveMarker);
  const removeMarker = useDocumentStore((s) => s.removeMarker);
  const markers = scene.markers ?? [];

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Remembers each object's lane assignment across renders so dragging one
  // clip's lifetime never reshuffles where unrelated clips sit.
  const laneMemoryRef = useRef(new Map<string, number>());

  const tracksRef = useRef<HTMLDivElement>(null);
  const [tracksColWidth, setTracksColWidth] = useState(0);
  const initializedZoomRef = useRef(false);

  // Track the live track-column width (needed for the visible-range tick
  // culling, the initial fit-to-width zoom, and clamping pan/zoom bounds).
  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setTracksColWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the whole scene duration to the viewport once, the first time we know
  // the track column's width. After that, zoom/pan is fully user-driven.
  useEffect(() => {
    if (initializedZoomRef.current || tracksColWidth === 0) return;
    initializedZoomRef.current = true;
    setTimelineZoom(clamp(tracksColWidth / duration, MIN_PX_PER_MS, MAX_PX_PER_MS), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksColWidth]);

  // Resolve, Premiere-style scroll mapping. Attached as a native, non-passive
  // listener (not React's onWheel, which several browsers/versions treat as
  // passive) since three of the four gestures must preventDefault: Shift
  // changes row height, Option/Alt zooms (centered on the cursor), Cmd/Ctrl
  // pans — otherwise Cmd+wheel would trigger the browser's page-zoom gesture.
  // Plain wheel is deliberately left alone so `.lanes`' native vertical
  // scroll keeps working exactly as before.
  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const { timelinePxPerMs, timelineViewStartMs, timelineRowScale } = useEditorStore.getState();
      if (e.shiftKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.001);
        setTimelineRowScale(timelineRowScale * factor);
      } else if (e.altKey) {
        e.preventDefault();
        const offsetPx = e.clientX - rect.left;
        const cursorMs = timelineViewStartMs + offsetPx / timelinePxPerMs;
        const nextPxPerMs = clamp(
          timelinePxPerMs * Math.exp(-e.deltaY * 0.0015),
          MIN_PX_PER_MS,
          MAX_PX_PER_MS,
        );
        const nextViewStart = computeZoomViewStart(cursorMs, nextPxPerMs, offsetPx);
        setTimelineZoom(nextPxPerMs, clampViewStart(nextViewStart, nextPxPerMs, rect.width, duration));
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const next = timelineViewStartMs + e.deltaY / timelinePxPerMs;
        setTimelineZoom(timelinePxPerMs, clampViewStart(next, timelinePxPerMs, rect.width, duration));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const msToPx = (t: number) => (t - timelineViewStartMs) * timelinePxPerMs;
  const pct: PctFn = (t) => `${msToPx(t)}px`;
  const timeAt: TimeAtFn = (clientX, rect) =>
    clamp(timelineViewStartMs + (clientX - rect.left) / timelinePxPerMs, 0, duration);

  // Reads live store state rather than this render's closure: a drag installs
  // one pointermove listener at pointerdown, so a render-time `scene` would stay
  // frozen at the values the drag started from for the whole gesture.
  const snapMs: SnapMsFn = (ms, exclude) => {
    const px = useEditorStore.getState().timelinePxPerMs;
    const live = getActiveScene(useDocumentStore.getState().project);
    return applyTimelineSnap(
      ms,
      live,
      timelineSnap,
      activeFps(),
      TIMELINE_SNAP_PX / px,
      exclude,
    );
  };
  const snappedTimeAt = (clientX: number, rect: DOMRect, exclude?: SnapExclude) =>
    snapMs(timeAt(clientX, rect), exclude);

  const scrubFrom = (clientX: number, rect: DOMRect) =>
    setPlayhead(snappedTimeAt(clientX, rect));

  const keyCamera = () => {
    const state = getCameraState();
    if (state) upsertCameraKeyframe(playheadMs, state);
  };

  // Ruler ticks at a "nice" spacing for the current zoom level, culled to the
  // visible time window (there is no zoom-out floor large enough to make an
  // uncapped full-duration loop expensive, but culling keeps deep zoom-ins
  // cheap too).
  const tickStep = tickStepMs(timelinePxPerMs);
  const visibleStartMs = Math.max(0, timelineViewStartMs);
  const visibleEndMs = Math.min(
    duration,
    timelineViewStartMs + (tracksColWidth || 1) / timelinePxPerMs,
  );
  const ticks: number[] = [];
  for (
    let t = Math.max(0, Math.floor(visibleStartMs / tickStep) * tickStep);
    t <= visibleEndMs;
    t += tickStep
  ) {
    ticks.push(t);
  }

  const objectRows = buildObjectRows(scene.objects, expanded, laneMemoryRef.current);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;

  return (
    <div
      className={styles.timeline}
      style={{ '--row-h': `${BASE_ROW_H_PX * timelineRowScale}px` } as React.CSSProperties}
    >
      <div className={styles.transport}>
        <button onClick={goToStart} title={`Go to start (${chordFor('nav.start')})`}>
          ⏮
        </button>
        <button
          className={playing ? 'primary' : ''}
          onClick={togglePlayPause}
          title={`Play / pause (${chordFor('play.toggle')}) · J K L to shuttle`}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button onClick={goToEnd} title={`Go to end (${chordFor('nav.end')})`}>
          ⏭
        </button>
        <button
          className={loop ? 'primary' : ''}
          onClick={toggleLoop}
          title={`Loop playback (${chordFor('play.loop')})`}
        >
          ⟳
        </button>
        <span className={styles.time}>
          {fmt(playheadMs)} / {fmt(duration)}
        </span>
        {playing && Math.abs(playRate) !== 1 && (
          <span className={styles.rateBadge}>
            {playRate < 0 ? '−' : ''}
            {Math.abs(playRate)}×
          </span>
        )}
        <div className={styles.spacer} />
        <button
          className={timelineSnap.second ? 'primary' : ''}
          onClick={() => setTimelineSnap({ second: !timelineSnap.second })}
          title="Snap to second"
        >
          1s
        </button>
        <button
          className={timelineSnap.frame ? 'primary' : ''}
          onClick={() => setTimelineSnap({ frame: !timelineSnap.frame })}
          title="Snap to frame"
        >
          Fr
        </button>
        <button
          className={timelineSnap.clip ? 'primary' : ''}
          onClick={() => setTimelineSnap({ clip: !timelineSnap.clip })}
          title="Snap to clips, markers & keyframes"
        >
          Clip
        </button>
        <button
          onClick={keyframeSelection}
          disabled={selectedIds.length === 0}
          title={`Add keyframe at playhead (${chordFor('key.add')})`}
        >
          ◆ Key
        </button>
        <button onClick={keyCamera} title="Keyframe the camera at the playhead">
          ◆ Camera
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          title={`Keyboard shortcuts (${chordFor('help.toggle')})`}
        >
          ?
        </button>
      </div>

      <div className={styles.lanes}>
        {/* Left label column — mirrors the track column row-for-row. */}
        <div className={styles.labels}>
          <div className={styles.rulerLabel} />
          {objectRows.map((r) => (
            <div
              key={r.key}
              className={styles.labelCell}
              style={{ paddingLeft: 8 + r.depth * 12 }}
            >
              <span className={`${styles.labelText} ${r.head ? styles.labelHead : ''}`}>
                {r.label ?? ''}
              </span>
            </div>
          ))}
          <div className={styles.labelCell}>
            <span className={`${styles.labelText} ${styles.labelHead}`}>Scene</span>
          </div>
          {audioTracks.map((track) => (
            <AudioTrackLabel key={track.id} track={track} />
          ))}
          <div className={styles.addTrackRow}>
            <button
              className={`${styles.addTrackBtn}`}
              onClick={() => addAudioTrack()}
              title="Add an audio track"
            >
              + Audio track
            </button>
          </div>
        </div>

        {/* Right track column with the scrub-anywhere playhead overlay. */}
        <div
          className={styles.tracksCol}
          ref={tracksRef}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            scrubFrom(e.clientX, rect);
            beginDrag(rect, (x) => scrubFrom(x, rect));
          }}
        >
          {/* Marked play range, spanning every lane so it reads as a range. */}
          {(inMs != null || outMs != null) && (
            <div
              className={styles.inOutBand}
              style={{
                left: pct(inMs ?? 0),
                width: pct((outMs ?? duration) - (inMs ?? 0)),
              }}
            />
          )}

          {/* Ruler */}
          <div className={styles.ruler}>
            {ticks.map((t) => (
              <div key={t} className={styles.tick} style={{ left: pct(t) }}>
                <span>{formatTickLabel(t, tickStep)}</span>
              </div>
            ))}
            {inMs != null && (
              <div
                className={`${styles.markHandle} ${styles.markIn}`}
                style={{ left: pct(inMs) }}
                title="In point — drag to move"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const rect = tracksRef.current!.getBoundingClientRect();
                  beginDrag(rect, (x) => setInPoint(snappedTimeAt(x, rect)));
                }}
              />
            )}
            {outMs != null && (
              <div
                className={`${styles.markHandle} ${styles.markOut}`}
                style={{ left: pct(outMs) }}
                title="Out point — drag to move"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const rect = tracksRef.current!.getBoundingClientRect();
                  beginDrag(rect, (x) => setOutPoint(snappedTimeAt(x, rect)));
                }}
              />
            )}
            {markers.map((m) => (
              <div
                key={m.id}
                className={styles.marker}
                style={{ left: pct(m.timeMs), background: m.color }}
                title={`${m.name} — drag to move, double-click to delete`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setPlayhead(m.timeMs);
                  const rect = tracksRef.current!.getBoundingClientRect();
                  beginDrag(rect, (x) =>
                    moveMarker(m.id, snappedTimeAt(x, rect, { markerIds: [m.id] })),
                  );
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  removeMarker(m.id);
                }}
              />
            ))}
          </div>

          {/* Object lanes (packed clips), extending up from the scene lane. */}
          {objectRows.map((r) => (
            <div key={r.key} className={styles.track}>
              {r.clips.map((obj) => (
                <ObjectClip
                  key={obj.id}
                  object={obj}
                  pct={pct}
                  timeAt={timeAt}
                  snapMs={snapMs}
                  tracksRef={tracksRef}
                  selected={obj.id === selectedId}
                  hasChildren={childrenOf(scene.objects, obj.id).length > 0}
                  expanded={expanded.has(obj.id)}
                  onToggleExpand={() => toggleExpand(obj.id)}
                />
              ))}
            </div>
          ))}

          {/* Scene lane (camera keyframes) — the middle anchor. */}
          <div className={`${styles.track} ${styles.sceneRegionTrack}`}>
            <div className={styles.sceneBar} />
            {keyframeTimes(scene.camera.tracks).map((time) => (
              <button
                key={time}
                className={`${styles.kf} ${styles.camKf}`}
                style={{ left: pct(time) }}
                title={`Camera keyframe @ ${fmt(time)} — click to jump, double-click to delete`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setPlayhead(time);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  removeCameraKeyframeAtTime(time);
                }}
              />
            ))}
          </div>

          {/* Audio lanes, extending down from the scene lane. */}
          {audioTracks.map((track) => (
            <div key={track.id} className={`${styles.track} ${styles.audioRegion}`}>
              {track.clips.map((clip) => (
                <AudioClipBar
                  key={clip.id}
                  track={track}
                  clip={clip}
                  pct={pct}
                  timeAt={timeAt}
                  snapMs={snapMs}
                  tracksRef={tracksRef}
                />
              ))}
            </div>
          ))}

          {/* Footer spacer matching the "+ Audio track" label row. */}
          <div className={styles.addTrackRow} />

          {/* Playhead spanning all lanes */}
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

function ObjectClip({
  object,
  pct,
  timeAt,
  snapMs,
  tracksRef,
  selected,
  hasChildren,
  expanded,
  onToggleExpand,
}: {
  object: SceneObject;
  pct: PctFn;
  timeAt: TimeAtFn;
  snapMs: SnapMsFn;
  tracksRef: React.RefObject<HTMLDivElement>;
  selected: boolean;
  hasChildren: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setObjectLifetime = useDocumentStore((s) => s.setObjectLifetime);
  const moveKeyframesAtTime = useDocumentStore((s) => s.moveKeyframesAtTime);
  const deleteKeyframesAtTime = useDocumentStore((s) => s.deleteKeyframesAtTime);
  const remapKeyframeTimes = useDocumentStore((s) => s.remapKeyframeTimes);

  const { startMs, endMs } = object.lifetime;

  const dragHandle = (which: 'start' | 'end' | 'body', e: React.PointerEvent) => {
    e.stopPropagation();
    setSelection([object.id]);
    const rect = tracksRef.current!.getBoundingClientRect();
    const startLife = { ...object.lifetime };
    const grabTime = timeAt(e.clientX, rect);
    const scale = e.shiftKey;
    // The object being dragged must not be its own snap target.
    const exclude: SnapExclude = { objectIds: [object.id] };
    const move = (clientX: number) => {
      if (which === 'start' || which === 'end') {
        const t = snapMs(timeAt(clientX, rect), exclude);
        if (which === 'start') setObjectLifetime(object.id, { startMs: t, endMs: startLife.endMs });
        else setObjectLifetime(object.id, { startMs: startLife.startMs, endMs: t });
        return;
      }
      // Body: snap the clip's own edges, never the cursor — snapping the cursor
      // and adding the grab offset back leaves the edges off-grid by however far
      // into the clip the pointer went down.
      const rawDelta = timeAt(clientX, rect) - grabTime;
      const delta = clampDeltaToStart(
        startLife.startMs,
        snapBodyDelta(startLife.startMs, startLife.endMs, rawDelta, (ms) => snapMs(ms, exclude)),
      );
      setObjectLifetime(object.id, {
        startMs: startLife.startMs + delta,
        endMs: startLife.endMs + delta,
      });
    };
    const m = (ev: PointerEvent) => move(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', m);
      window.removeEventListener('pointerup', up);
      // Resizing an end remaps keyframes (move boundary, or scale all with Shift).
      if (which !== 'body') {
        const obj = getActiveScene(useDocumentStore.getState().project).objects.find(
          (o) => o.id === object.id,
        );
        if (obj) {
          remapKeyframeTimes(object.id, startLife, obj.lifetime, scale ? 'scale' : 'boundary');
        }
      }
    };
    window.addEventListener('pointermove', m);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div
        className={`${styles.lifetime} ${selected ? styles.selected : ''}`}
        style={{ left: pct(startMs), width: `calc(${pct(endMs)} - ${pct(startMs)})` }}
        onPointerDown={(e) => dragHandle('body', e)}
        title={`${object.name} — drag to move, edges to resize`}
      >
        <div
          className={`${styles.lifeHandle} ${styles.left}`}
          onPointerDown={(e) => dragHandle('start', e)}
        />
        {hasChildren && (
          <button
            className={styles.chevron}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            title={expanded ? 'Collapse group' : 'Expand group'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <span className={styles.clipLabel}>{object.name}</span>
        <div
          className={`${styles.lifeHandle} ${styles.right}`}
          onPointerDown={(e) => dragHandle('end', e)}
        />
      </div>

      {keyframeTimes(object.tracks).map((time) => (
        <button
          key={time}
          className={styles.kf}
          style={{ left: pct(time) }}
          title={`Keyframe @ ${(time / 1000).toFixed(2)}s — click to jump, double-click to delete`}
          onPointerDown={(e) => {
            e.stopPropagation();
            setSelection([object.id]);
            const rect = tracksRef.current!.getBoundingClientRect();
            setPlayhead(time);
            // Track the live position so successive moves chain correctly.
            let cur = time;
            const m = (ev: PointerEvent) => {
              // Exclude the keyframe's own live time, or it snaps back to itself.
              const next = snapMs(timeAt(ev.clientX, rect), { times: [cur] });
              moveKeyframesAtTime(object.id, cur, next);
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
            deleteKeyframesAtTime(object.id, time);
          }}
        />
      ))}
    </>
  );
}

function AudioClipBar({
  track,
  clip,
  pct,
  timeAt,
  snapMs,
  tracksRef,
}: {
  track: AudioTrack;
  clip: AudioClip;
  pct: PctFn;
  timeAt: TimeAtFn;
  snapMs: SnapMsFn;
  tracksRef: React.RefObject<HTMLDivElement>;
}) {
  const setAudioClipTime = useDocumentStore((s) => s.setAudioClipTime);
  const setAudioClipRange = useDocumentStore((s) => s.setAudioClipRange);
  const removeAudioClip = useDocumentStore((s) => s.removeAudioClip);
  const moveAudioClipResolved = useDocumentStore((s) => s.moveAudioClipResolved);
  const timelinePxPerMs = useEditorStore((s) => s.timelinePxPerMs);
  const timelineRowScale = useEditorStore((s) => s.timelineRowScale);

  const startMs = clip.startMs;
  const endMs = clip.startMs + clip.durationMs;
  const MIN = 50;

  const drag = (which: 'start' | 'end' | 'body', e: React.PointerEvent) => {
    e.stopPropagation();
    const rect = tracksRef.current!.getBoundingClientRect();
    const base = { ...clip };
    const grabTime = timeAt(e.clientX, rect);
    // The clip being dragged must not be its own snap target.
    const exclude: SnapExclude = { audioClipIds: [clip.id] };
    // Remembered so pointerup can resolve overlaps at the final position.
    let lastStartMs = base.startMs;
    const move = (clientX: number) => {
      if (which === 'body') {
        // Snap the clip's own edges, not the cursor (see dragSnap.ts).
        const rawDelta = timeAt(clientX, rect) - grabTime;
        const delta = clampDeltaToStart(
          base.startMs,
          snapBodyDelta(base.startMs, base.startMs + base.durationMs, rawDelta, (ms) =>
            snapMs(ms, exclude),
          ),
        );
        lastStartMs = base.startMs + delta;
        setAudioClipTime(track.id, clip.id, lastStartMs);
        return;
      }
      const t = snapMs(timeAt(clientX, rect), exclude);
      if (which === 'start') {
        // Move the left edge, keeping the source content under it fixed.
        let ns = t;
        ns = Math.max(base.startMs - base.offsetMs, ns); // can't trim before source start
        ns = Math.min(base.startMs + base.durationMs - MIN, ns);
        const delta = ns - base.startMs;
        setAudioClipRange(track.id, clip.id, {
          startMs: ns,
          offsetMs: base.offsetMs + delta,
          durationMs: base.durationMs - delta,
        });
      } else {
        setAudioClipRange(track.id, clip.id, {
          startMs: base.startMs,
          offsetMs: base.offsetMs,
          durationMs: Math.max(MIN, t - base.startMs),
        });
      }
    };
    const m = (ev: PointerEvent) => move(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', m);
      window.removeEventListener('pointerup', up);
      // Overwrite-resolve whatever the clip landed on — once, at the end of the
      // gesture. Doing it per pointermove would repeatedly destroy the clip
      // being swept across (and each pointermove is its own undo entry).
      if (which === 'body' && lastStartMs !== base.startMs) {
        moveAudioClipResolved(track.id, clip.id, lastStartMs);
      }
    };
    window.addEventListener('pointermove', m);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={styles.audioClip}
      style={{ left: pct(startMs), width: `calc(${pct(endMs)} - ${pct(startMs)})` }}
      onPointerDown={(e) => drag('body', e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        removeAudioClip(track.id, clip.id);
      }}
      title={`${clip.name} — drag to move, edges to trim, double-click to remove`}
    >
      <WaveformCanvas
        mediaId={clip.mediaId}
        offsetMs={clip.offsetMs}
        durationMs={clip.durationMs}
        widthPx={clip.durationMs * timelinePxPerMs}
        heightPx={BASE_ROW_H_PX * timelineRowScale}
      />
      <div
        className={`${styles.lifeHandle} ${styles.left}`}
        onPointerDown={(e) => drag('start', e)}
      />
      <span className={styles.clipLabel}>{clip.name}</span>
      <div
        className={`${styles.lifeHandle} ${styles.right}`}
        onPointerDown={(e) => drag('end', e)}
      />
    </div>
  );
}

function AudioTrackLabel({ track }: { track: AudioTrack }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const setAudioTrackMuted = useDocumentStore((s) => s.setAudioTrackMuted);
  const renameAudioTrack = useDocumentStore((s) => s.renameAudioTrack);
  const removeAudioTrack = useDocumentStore((s) => s.removeAudioTrack);
  const addAudioClip = useDocumentStore((s) => s.addAudioClip);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const playheadMs = useEditorStore.getState().playheadMs;
    for (const file of Array.from(files)) {
      const { mediaId, durationMs } = await importAudioFile(file);
      addAudioClip(track.id, {
        id: nanoid(),
        name: file.name.replace(/\.[^.]+$/, ''),
        mediaId,
        startMs: playheadMs,
        offsetMs: 0,
        durationMs,
        sourceDurationMs: durationMs,
        gain: 1,
        loop: false,
      });
    }
  };

  return (
    <div className={styles.labelCell}>
      <button
        className={`${styles.iconBtn} ${track.muted ? styles.muted : ''}`}
        onClick={() => setAudioTrackMuted(track.id, !track.muted)}
        title={track.muted ? 'Unmute track' : 'Mute track'}
      >
        {track.muted ? '🔇' : '🔊'}
      </button>
      <input
        className={styles.trackName}
        defaultValue={track.name}
        onBlur={(e) => renameAudioTrack(track.id, e.target.value)}
        title="Track name"
      />
      <button
        className={styles.iconBtn}
        onClick={() => fileRef.current?.click()}
        title="Add audio clip at the playhead"
      >
        +
      </button>
      <button
        className={styles.iconBtn}
        onClick={() => removeAudioTrack(track.id)}
        title="Remove track"
      >
        ×
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { hasAudioBuffer, subscribeAudioDecoded } from '../../io/audioCache';
import { getWaveformPeaks, PEAKS_RESOLUTION, resamplePeaks } from '../../io/waveform';
import styles from './timeline.module.css';

/** Renders the peaks slice [offsetMs, offsetMs + durationMs) of a clip's
 * source waveform, sized to the clip's current on-screen box. */
export function WaveformCanvas({
  mediaId,
  offsetMs,
  durationMs,
  widthPx,
  heightPx,
}: {
  mediaId: string;
  offsetMs: number;
  durationMs: number;
  widthPx: number;
  heightPx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Re-render once the source finishes decoding, if it wasn't ready yet.
  useSyncExternalStore(subscribeAudioDecoded, () => hasAudioBuffer(mediaId));

  useEffect(() => {
    const canvas = canvasRef.current;
    const peaks = getWaveformPeaks(mediaId);
    if (!canvas || !peaks || widthPx <= 0 || heightPx <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = Math.round(heightPx * dpr);
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthPx, heightPx);

    const bucketMs = peaks.sourceDurationMs / PEAKS_RESOLUTION;
    const { mins, maxs } = resamplePeaks(
      peaks.mins,
      peaks.maxs,
      offsetMs / bucketMs,
      (offsetMs + durationMs) / bucketMs,
      Math.max(1, Math.ceil(widthPx)),
    );

    const mid = heightPx / 2;
    ctx.fillStyle = 'rgba(231, 233, 238, 0.55)'; // var(--text) at ~55% alpha — canvas fillStyle can't use var()
    for (let x = 0; x < mins.length; x++) {
      const y0 = mid + mins[x] * mid;
      const y1 = mid + maxs[x] * mid;
      ctx.fillRect(x, Math.min(y0, y1), 1, Math.max(1, Math.abs(y1 - y0)));
    }
  }, [mediaId, offsetMs, durationMs, widthPx, heightPx]);

  return <canvas ref={canvasRef} className={styles.waveform} />;
}

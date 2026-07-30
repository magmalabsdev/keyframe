import { useCallback, useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** Which panel edge a resize handle controls. */
export type ResizeEdge = 'left' | 'right' | 'bottom';

interface LayoutSize {
  leftW: number;
  rightW: number;
  bottomH: number;
}

const STORAGE_KEY = 'keyframe:layout';
const DEFAULTS: LayoutSize = { leftW: 264, rightW: 312, bottomH: 220 };
const MIN_SIDE = 160;
const MIN_BOTTOM = 120;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function load(): LayoutSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persisted, draggable sizes for the left / right / bottom panels. Returns the
 * current sizes (to feed the grid's CSS variables) and a `startDrag` factory
 * for each resize handle's onPointerDown.
 */
export function useResizableLayout() {
  const [size, setSize] = useState<LayoutSize>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [size]);

  const startDrag = useCallback(
    (edge: ResizeEdge) => (e: ReactPointerEvent) => {
      e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        setSize((s) => {
          if (edge === 'left') {
            return { ...s, leftW: clamp(ev.clientX, MIN_SIDE, window.innerWidth * 0.6) };
          }
          if (edge === 'right') {
            return {
              ...s,
              rightW: clamp(window.innerWidth - ev.clientX, MIN_SIDE, window.innerWidth * 0.6),
            };
          }
          return {
            ...s,
            bottomH: clamp(window.innerHeight - ev.clientY, MIN_BOTTOM, window.innerHeight * 0.8),
          };
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = edge === 'bottom' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  return { size, startDrag };
}

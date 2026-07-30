/**
 * React bindings for io/fonts.ts: components re-render when a font's blob
 * hydrates (project load) or its parsed Font resolves.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { subscribeMedia } from '../io/mediaCache';
import { getFontUrl, loadThreeFont } from '../io/fonts';

/** Font URL for troika text; swaps from bundled to the real font on hydration. */
export function useFontUrl(fontId: string | undefined): string {
  return useSyncExternalStore(subscribeMedia, () => getFontUrl(fontId));
}

/** Parsed three Font for extrusion; null until loaded. */
export function useThreeFont(fontId: string | undefined): Font | null {
  const invalidate = useThree((s) => s.invalidate);
  const url = useFontUrl(fontId); // changes when the blob hydrates -> retry load
  const [font, setFont] = useState<Font | null>(null);
  useEffect(() => {
    let alive = true;
    loadThreeFont(fontId)
      .then((f) => {
        if (!alive) return;
        setFont(f);
        invalidate();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fontId, url, invalidate]);
  return font;
}

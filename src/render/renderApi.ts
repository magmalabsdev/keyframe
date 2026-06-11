import type { RootState } from '@react-three/fiber';

/**
 * Exposes the R3F root state (renderer, scene, camera, frameloop control) to the
 * video exporter, which lives outside the Canvas. RenderRegistrar registers the
 * store getter on mount.
 */
let getState: (() => RootState) | null = null;

export function registerR3F(getter: (() => RootState) | null): void {
  getState = getter;
}

export function getR3F(): RootState | null {
  return getState ? getState() : null;
}

import { useActiveScene } from '../state/documentStore';
import { DEFAULT_AMBIENT_INTENSITY } from '../state/defaults';

/**
 * The scene's uniform fill light. Without it a face turned away from every
 * placed light renders pure black (there is no other built-in lighting), which
 * makes upright text and side faces unreadable. Adjustable per scene — 0
 * restores lights-only lighting.
 *
 * Its own component rather than inline in Viewport: Viewport deliberately does
 * not subscribe to the document store, so reading the scene there would
 * re-render the whole Canvas subtree on every edit (see SceneBackground).
 */
export function SceneAmbient() {
  const intensity = useActiveScene().settings.ambientIntensity ?? DEFAULT_AMBIENT_INTENSITY;
  // Always mounted, even at 0: changing the number of lights in the scene
  // recompiles every lit material (same reason lights stay mounted in applyPose).
  return <ambientLight intensity={intensity} />;
}

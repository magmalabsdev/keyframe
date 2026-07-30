/**
 * Resolves which "form" (chunked) transition governs an object's start/end
 * edge, following the glyph -> parent-text cascade.
 *
 * A text object has no geometry of its own; its glyph children draw. So a form
 * transition set on the text cascades to every glyph, making the whole word
 * fragment as one. Auto-created glyphs leave their own transitions undefined,
 * so inheriting is the default; anything explicitly set on a glyph — form or
 * not — wins for that edge.
 *
 * Shared by pose.ts (which drives the animation) and SceneObjects.tsx (which
 * mounts the chunk meshes) so the two can never disagree about what applies.
 */
import { isFormTransition, type SceneObject, type Transition } from '../state/types';

export function effectiveFormTransition(
  obj: SceneObject,
  which: 'start' | 'end',
  parent?: SceneObject,
): Transition | null {
  const own = which === 'start' ? obj.startAnim : obj.endAnim;
  if (own && own.type !== 'none') {
    return isFormTransition(own.type) ? own : null;
  }
  if (obj.type === 'glyph' && parent?.type === 'text') {
    const inherited = which === 'start' ? parent.startAnim : parent.endAnim;
    if (inherited && isFormTransition(inherited.type)) return inherited;
  }
  return null;
}

/**
 * Whether focus is currently in a text-entry control.
 *
 * Global keyboard shortcuts and the viewport's camera keys both consult this so
 * typing a name, an expression, or a number never triggers an editor action.
 * Deliberately dependency-free: the viewport imports it too.
 */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

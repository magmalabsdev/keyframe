import { useEffect } from 'react';
import { isTyping } from './isTyping';
import { matchBinding } from './keymap';

/**
 * Binds every shortcut in app/keymap.ts. The table is the only place bindings
 * are declared; this just dispatches into it.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const binding = matchBinding(e);
      if (!binding) return;
      if (!binding.allowWhileTyping && isTyping()) return;
      // Held keys auto-repeat: fine for stepping, wrong for anything that
      // toggles or ramps (a held J would rocket straight to 8x).
      if (e.repeat && !binding.repeatable) return;
      if (binding.when && !binding.when()) return;
      // Always claim the key — the viewport's camera listener checks
      // defaultPrevented so the two can't both act on one press.
      e.preventDefault();
      binding.run();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

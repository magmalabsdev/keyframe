import { useEffect } from 'react';
import { restoreAutosave, startAutosave } from '../io/persistence';

/** Restores the autosaved project on startup, then enables debounced autosave. */
export function useInitPersistence(): void {
  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    void (async () => {
      await restoreAutosave();
      if (!cancelled) unsubscribe = startAutosave();
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}

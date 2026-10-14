// No save button (admin spec §5): edits pile up into one patch and go out
// DELAY_MS after the last one. A patch that fails stays in the pile and goes
// out again with the next edit; nothing typed is rolled back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { deepMerge } from './merge';
import type { Detail, Patch } from './types';

export function useAutoSave(id: string, onSaved: (d: Detail) => void, delayMs = 500) {
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const [error, setError] = useState<string | null>(null);

  const flush = useCallback(async () => {
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    try {
      const d = await api.patch(id, patch);
      setError(null);
      saved.current(d);
    } catch (err) {
      // Older edits underneath newer ones made while this was in flight.
      pending.current = deepMerge(patch, pending.current);
      setError((err as Error).message);
    }
  }, [id]);

  const queue = useCallback((p: Patch) => {
    pending.current = deepMerge(pending.current, p);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delayMs);
  }, [flush, delayMs]);

  // Leaving a character with an edit still waiting saves it now.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void flush();
    }
  }, [flush]);

  return { queue, error };
}

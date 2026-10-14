import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Summary } from './types';

/** The list, refreshed every pollMs; `down` while the brain does not answer. */
export function useCharacters(pollMs: number) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [down, setDown] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setList(await api.list());
      setDown(false);
    } catch {
      setDown(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);
  return { list, down, refresh };
}

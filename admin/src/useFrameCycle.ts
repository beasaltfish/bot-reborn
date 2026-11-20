import { useEffect, useState } from 'react';

/** One frame every 1200 ms, the pace a still preview reads at. */
const STEP_MS = 1200;

/**
 * The frame to show now, or null when there is nothing to show. One frame is
 * a picture, not a slideshow, so it starts no timer at all.
 * @param {string[]} frames
 * @returns {string | null}
 */
export function useFrameCycle(frames: string[]) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = setInterval(() => setAt((n) => (n + 1) % frames.length), STEP_MS);
    return () => clearInterval(timer);
  }, [frames.length]);
  return frames.length > 0 ? frames[at % frames.length] : null;
}

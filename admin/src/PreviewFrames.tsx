// A still carousel over the frames a body actually has.
//
// Not an animation player: the brain's frames are timed for the screen, and
// running them here would say the admin is watching the thing live. One frame
// every 1200 ms says "this is what it looks like" and nothing more.
import { useEffect, useState } from 'react';

const STEP_MS = 1200;

export function PreviewFrames({ frames, alt }: { frames: string[]; alt: string }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = setInterval(() => setAt((n) => (n + 1) % frames.length), STEP_MS);
    return () => clearInterval(timer);
  }, [frames.length]);
  return <img src={frames[at % frames.length]} alt={alt} />;
}

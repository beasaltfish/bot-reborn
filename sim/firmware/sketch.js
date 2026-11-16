// Run a firmware's tick at 10 Hz. The caller supplies the context (inputs and
// outputs) and a render step; this owns only the clock and the stop.
/** @param {{ firmware: import('./index.js').Firmware, ctx: () => any, render?: () => void, intervalMs?: number }} o */
export function createSketchRunner({ firmware, ctx, render, intervalMs = 100 }) {
  /** @type {ReturnType<typeof setInterval> | null} */ let timer = null;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const context = ctx();
    /** @type {any} */ (firmware).tick?.(context);
    render?.();
  };
  return {
    start() {
      if (timer || stopped) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

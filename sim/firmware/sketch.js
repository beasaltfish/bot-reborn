// Run a firmware's tick at 10 Hz. The caller supplies the context (inputs and
// outputs) and a render step; this owns only the clock and the stop.
/** @param {{ firmware: import('./index.js').Firmware, ctx: () => any, render?: () => void, onTrace?: (records: any[]) => void, onTiming?: (ms: number) => void, intervalMs?: number }} o */
export function createSketchRunner({ firmware, ctx, render, onTrace, onTiming, intervalMs = 100 }) {
  /** @type {ReturnType<typeof setInterval> | null} */ let timer = null;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const context = ctx();
    const started = performance.now();
    const out = /** @type {any} */ (firmware).tick?.(context);
    onTiming?.(performance.now() - started);
    if (Array.isArray(out)) onTrace?.(out);
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

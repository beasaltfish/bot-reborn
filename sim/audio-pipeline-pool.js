// A successfully used microphone stays held as before. An abandoned startup
// owns only a reservation, so it cannot close a newer session's reservation.
/** @template {{stop():void}} T @param {(echo:boolean, signal?:AbortSignal) => Promise<T>} start */
export function createPipelinePool(start) {
  /** @type {{echo:boolean, pipeline:T, leases:number, used:boolean, disposed:boolean} | null} */
  let held = null;
  /** @param {{echo:boolean, pipeline:T, leases:number, used:boolean, disposed:boolean}} entry */
  function dispose(entry) {
    if (entry.disposed) return;
    entry.disposed = true;
    if (held === entry) held = null;
    entry.pipeline.stop();
  }
  /** @param {{echo:boolean, pipeline:T, leases:number, used:boolean, disposed:boolean}} entry */
  function reserve(entry) {
    entry.leases++;
    let finished = false;
    /** @param {boolean} used */
    const finish = used => {
      if (finished) return;
      finished = true;
      entry.leases--;
      if (used) entry.used = true;
      if (!entry.used && entry.leases === 0) dispose(entry);
    };
    return { pipeline: entry.pipeline, commit: () => finish(true), cancel: () => finish(false) };
  }
  return {
    /** @param {boolean} echo @param {() => boolean} current @param {AbortSignal} [signal] */
    async acquire(echo, current, signal) {
      if (!current()) return null;
      if (held && held.echo === echo) return reserve(held);
      const pipeline = await start(echo, signal);
      if (!current()) { pipeline.stop(); return null; }
      if (held) dispose(held);
      const entry = { echo, pipeline, leases: 0, used: false, disposed: false };
      held = entry;
      return reserve(entry);
    },
  };
}

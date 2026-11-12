import { blockingBoardPowerFault } from './board-power-gate.js';

/** @typedef {ReturnType<typeof import('./devices/evaluate.js').evaluateBench>} BenchOutcome */
/** @param {import('./bench.js').Bench} bench @param {BenchOutcome} result */
function safetyFault(bench, result) {
  if (result.legacy.esp === 'brownout') return result.legacy.faults.find(fault => fault.code === 'short-rails') ?? null;
  return blockingBoardPowerFault(bench, result);
}

/** Latch a newly unsafe powered board until the user cycles USB power.
 * @param {() => void} stop
 */
export function createPowerInterlock(stop) {
  let tripped = false;
  return {
    /** @param {import('./bench.js').Bench} bench @param {BenchOutcome} result */
    arm(bench, result) { tripped = Boolean(safetyFault(bench, result)); },
    /** @param {import('./bench.js').Bench} bench @param {BenchOutcome} result */
    observe(bench, result) {
      const fault = safetyFault(bench, result);
      if (fault && !tripped) { tripped = true; stop(); }
      return fault;
    },
    tripped: () => tripped,
    reset() { tripped = false; },
  };
}

/** A late completion must not release a newer asynchronous start. */
export function createStartLock() {
  /** @type {number | null} */ let owner = null;
  return {
    /** @param {number} token */ begin(token) { owner = token; },
    /** @param {number} token */ release(token) { if (owner === token) owner = null; },
    clear() { owner = null; },
    locked: () => owner !== null,
  };
}

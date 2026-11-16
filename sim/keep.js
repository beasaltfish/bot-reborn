// The bench the user had, put aside while the simulator builds one for them.
// Storage can refuse (private windows, blocked site data); then nothing is
// kept and there is nothing to go back to.
import { load, serialize } from './bench.js';

/** @typedef {import('./bench.js').Bench} Bench */
/** @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} Store */

export const KEEP_KEY = 'botreborn.sim.mybench';

/**
 * @param {Store} store
 * @param {Bench} b
 */
export function keepBench(store, b) {
  try { store.setItem(KEEP_KEY, serialize({ ...b, usb: false })); } catch { /* not kept */ }
}

/**
 * @param {Store} store
 * @returns {Bench | null}
 */
export function keptBench(store) {
  try {
    const text = store.getItem(KEEP_KEY);
    return text === null ? null : { ...load(text), usb: false };
  } catch {
    return null;
  }
}

/** @param {Store} store */
export function dropKept(store) {
  try { store.removeItem(KEEP_KEY); } catch { /* nothing to drop */ }
}

/**
 * Put the user's wiring back but keep the board they have now: one physical
 * board, so its firmware, NVS and damage do not roll back with the cables.
 * @param {Bench} saved @param {Bench} current
 * @returns {Bench}
 */
export function mergeKeptBench(saved, current) {
  const now = current.placed.find((part) => part.part === 'esp32');
  return {
    ...saved,
    v: 4,
    usb: false,
    board: current.board,
    placed: saved.placed.map((part) => (part.part === 'esp32' && now ? { ...part, burnt: now.burnt } : part)),
  };
}

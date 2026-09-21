// Shared readings and the page log.
//
// rms / dbOf / aboveFloor moved to web/audio/level.js on 2026-09-17, when
// session.js came to need them: a panel may import from the product, never the
// other way round. They are re-exported here so every panel and every existing
// test keeps one import site.

export { rms, dbOf, aboveFloor } from '../audio/level.js';
import { dbOf } from '../audio/level.js';

/** @param {number} n @param {number} [digits] */
export function fmt(n, digits = 1) {
  return Number(n).toFixed(digits);
}

/** @param {number} amplitude @returns {string} for display */
export function dbs(amplitude) {
  return amplitude > 0 ? `${fmt(dbOf(amplitude), 0)} dB` : '−∞';
}

/** The bench floor that refuses nothing — dbOf's own clamp for zero, so even a
 *  bit-exact silent segment passes it. The panel still ships at this value: the
 *  product has a measured floor now, but the bench's job is to SHOW what the
 *  VAD cut, and a gate that swallowed the silent case would hide the one
 *  reading the level was added to expose. */
export const DB_FLOOR_OFF = -120;

/**
 * A running count / mean / max. Every per-frame cost and every window level on
 * this page goes through one.
 *
 * `mean` returns 0 when empty rather than NaN: "no frames yet" is the normal
 * state before Run is pressed, and NaN would sit in the stat row looking like
 * a fault.
 */
export function createMeter() {
  let count = 0, sum = 0, max = 0;
  return {
    /** @param {number} v */
    add(v) { count++; sum += v; if (v > max) max = v; },
    get count() { return count; },
    get mean() { return count ? sum / count : 0; },
    get max() { return max; },
    reset() { count = 0; sum = 0; max = 0; },
  };
}

// --- DOM ------------------------------------------------------------------

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {HTMLElement} el
 * @returns {(msg: string) => void}
 */
export function createLog(el) {
  /** @type {string[]} */
  const lines = [];
  return (msg) => {
    lines.push(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);
    if (lines.length > 400) lines.shift();
    el.textContent = lines.join('\n');
    el.scrollTop = el.scrollHeight;
  };
}

/** @param {string} id @param {string} text */
export function setStat(id, text) {
  $(id).textContent = text;
}

/** @param {string} id @param {boolean} on */
export function setDisabled(id, on) {
  /** @type {HTMLButtonElement | HTMLInputElement | HTMLSelectElement} */
  (/** @type {unknown} */ ($(id))).disabled = on;
}

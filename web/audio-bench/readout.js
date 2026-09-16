// Shared readings and the page log.
//
// The four functions at the top are pure and tested: every panel's verdict is
// built out of them, and one of them has a floor that matters. dbOf(0) returns
// −120 rather than −Infinity because a silent window is the NORMAL case here —
// the noise-floor window is supposed to be quiet — and −Infinity propagates
// through every later subtraction until the whole row reads NaN.

/** @param {Float32Array} f32 */
export function rms(f32) {
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

/** @param {number} amplitude linear, 1 = full scale @returns {number} dBFS */
export function dbOf(amplitude) {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -120;
}

/** @param {number} n @param {number} [digits] */
export function fmt(n, digits = 1) {
  return Number(n).toFixed(digits);
}

/** @param {number} amplitude @returns {string} for display */
export function dbs(amplitude) {
  return amplitude > 0 ? `${fmt(dbOf(amplitude), 0)} dB` : '−∞';
}

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

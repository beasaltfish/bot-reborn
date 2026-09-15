// The only file that knows the wasm bundle is a classic script.
//
// It hangs Module / createKws / createVad on the global object, and sherpa's
// own CircularBuffer is a top-level `class` — that lands in the global LEXICAL
// environment, not on `window`, so an ES module cannot reach it at all. Keeping
// every bit of that in here is what lets kws.js and vad.js look like normal
// modules.

import { parseTokens } from './keyword-lines.js';

export const MODELS_BASE = './models/kws/';

// Two glue files, one Module — this is the whole point of the combined build
// (the VAD symbols are exported from wasm/kws/CMakeLists.txt so both engines
// live in one 12 MB binary). Order matters only in that both must precede the
// engine. Build recipe: docs/hardware.md.
const GLUE = [
  'sherpa-onnx-kws.js',
  'sherpa-onnx-vad.js',
  'sherpa-onnx-wasm-kws-main.js',
];

/** @typedef {{ Module: any, createKws: Function, createVad: Function, tokens: Set<string> }} Sherpa */

/**
 * @param {(status: string) => void} [onStatus]
 * @returns {Promise<Sherpa>}
 */
export async function loadSherpa(onStatus = () => {}) {
  const g = /** @type {any} */ (globalThis);
  const tokens = parseTokens(
    await (await fetch(MODELS_BASE + 'tokens.txt')).text(),
  );
  await new Promise((resolve, reject) => {
    g.Module = {
      locateFile: (/** @type {string} */ p) => MODELS_BASE + p,
      setStatus: onStatus,
      onRuntimeInitialized: resolve,
      onAbort: (/** @type {string} */ why) => reject(new Error('wasm abort: ' + why)),
      printErr: (/** @type {string} */ s) => console.warn('[wasm]', s),
    };
    (function next(/** @type {number} */ i) {
      const el = document.createElement('script');
      el.src = MODELS_BASE + GLUE[i];
      el.onload = () => void (i + 1 < GLUE.length && next(i + 1));
      el.onerror = () => reject(new Error('failed to load ' + GLUE[i]));
      document.body.appendChild(el);
    })(0);
  });
  return { Module: g.Module, createKws: g.createKws, createVad: g.createVad, tokens };
}

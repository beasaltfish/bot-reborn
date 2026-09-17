// The only file that knows the wasm bundle is a classic script.
//
// It hangs Module / createKws / createVad on the global object, and sherpa's
// own CircularBuffer is a top-level `class` — that lands in the global LEXICAL
// environment, not on `window`, so an ES module cannot reach it at all. Keeping
// every bit of that in here is what lets kws.js and vad.js look like normal
// modules.

import { parseTokens } from './keyword-lines.js';
import { cachedBytes } from './model-cache.js';

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

// The two that are worth keeping across visits: 12.8 MB and 6.1 MB against
// 100 KB for all three glue files put together. These are also the only two
// the engine offers a hook for, which is not a coincidence — they are the ones
// it was expected people would want to supply themselves.
const WASM = 'sherpa-onnx-wasm-kws-main.wasm';
const DATA = 'sherpa-onnx-wasm-kws-main.data';

/** @typedef {{ Module: any, createKws: Function, createVad: Function, tokens: Set<string> }} Sherpa */

/** How long the whole load may take before it is called a failure. Generous:
 *  ~8 MB over a phone's connection on first visit, cached afterwards. */
const LOAD_TIMEOUT_MS = 90_000;

/**
 * Every step reports itself, and a stall becomes an error rather than silence.
 *
 * This loader used to be able to hang forever saying nothing: emscripten's own
 * setStatus never fires before the engine glue runs, printErr went to a console
 * nobody can see on a phone, and onAbort only covers aborts — not a script that
 * loads and simply never initialises. A start that hung looked exactly like one
 * that was slow, which is the same silent-failure shape as everything else this
 * project has had to dig out.
 *
 * @param {(status: string) => void} [onStatus]
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Sherpa>}
 */
export function loadSherpa(onStatus = () => {}, opts = {}) {
  // One injection per page, ever — success or failure.
  //
  // The glue files are classic scripts declaring top-level classes (Stream,
  // CircularBuffer, ExitStatus). A second injection is an immediate
  // "Identifier 'Stream' has already been declared", after which the engine
  // never initialises and the page waits forever with the error only in a
  // console no phone can show. Measured on a real phone on 2026-09-17, by
  // pressing the one button twice — which is exactly what a person does when
  // the first press appears to do nothing.
  //
  // A failed attempt is cached too, deliberately. The scripts are already in
  // the document by then, so a retry cannot work; what it can do is hang. The
  // honest answer is to keep failing, and to say that a reload is the way out.
  attempt ??= begin(onStatus, opts);
  return attempt;
}

/** @type {Promise<Sherpa> | null} */
let attempt = null;

/**
 * @param {(status: string) => void} onStatus
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<Sherpa>}
 */
async function begin(onStatus, opts) {
  const g = /** @type {any} */ (globalThis);
  onStatus('… tokens.txt');
  const res = await fetch(MODELS_BASE + 'tokens.txt');
  if (!res.ok) throw new Error(`tokens.txt: ${res.status} ${res.statusText}`);
  const tokens = parseTokens(await res.text());

  // §9.2: ask to stop being evictable before filling 19 MB of a best-effort
  // bucket. Chrome decides heuristically and may say no — that is a known
  // state, not a failure, so it is reported and nothing branches on it.
  if (g.navigator?.storage?.persist) {
    onStatus(await g.navigator.storage.persist() ? 'storage: persistent' : 'storage: best-effort');
  }

  // Both before any glue runs: the engine reads wasmBinary during startup and
  // calls getPreloadedPackage synchronously, so there is no awaiting either of
  // them later.
  const big = async (/** @type {string} */ name) => cachedBytes(MODELS_BASE + name, {
    onProgress: (got, total) => onStatus(
      total ? `… ${name} ${Math.round((got / total) * 100)}%` : `… ${name} ${got >> 20} MB`,
    ),
  });
  const [wasmBinary, dataPackage] = await Promise.all([big(WASM), big(DATA)]);
  onStatus('✓ model bytes');

  /** Named so the timeout can say where it stopped, not merely that it did. */
  let at = 'tokens.txt';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`gave up after ${at} — reload the page to retry`)),
      opts.timeoutMs ?? LOAD_TIMEOUT_MS,
    );
    /** @param {Error} e */
    const fail = (e) => { clearTimeout(timer); reject(e); };
    g.Module = {
      locateFile: (/** @type {string} */ p) => MODELS_BASE + p,
      // Handed over rather than fetched. Both files are already in hand, and
      // letting emscripten fetch them again would put the 19 MB back on the
      // network every visit and leave the cache doing nothing.
      wasmBinary,
      getPreloadedPackage: (/** @type {string} */ name) =>
        (name.endsWith(DATA) ? dataPackage : null),
      setStatus: onStatus,
      onRuntimeInitialized: () => { clearTimeout(timer); resolve(undefined); },
      onAbort: (/** @type {string} */ why) => fail(new Error('wasm abort: ' + why)),
      // The engine's own count of what it is still waiting for. When the glue
      // has loaded and nothing else ever happens, this is the only thing that
      // says whether it is stuck on the 6 MB data package, the 12 MB wasm, or
      // neither — the difference between a slow network and a broken URL.
      monitorRunDependencies: (/** @type {number} */ left) => {
        at = `the engine, ${left} dependenc${left === 1 ? 'y' : 'ies'} left`;
        onStatus(`… ${left} left`);
      },
      // Onto the status line as well as the console: on a phone the console is
      // not reachable, and this is where the engine says what went wrong.
      printErr: (/** @type {string} */ s) => { console.warn('[wasm]', s); onStatus('wasm: ' + s); },
    };
    (function next(/** @type {number} */ i) {
      at = GLUE[i];
      onStatus('… ' + GLUE[i]);
      const el = document.createElement('script');
      el.src = MODELS_BASE + GLUE[i];
      el.onload = () => {
        onStatus('✓ ' + GLUE[i]);
        if (i + 1 < GLUE.length) next(i + 1);
        else at = 'the engine starting up';
      };
      el.onerror = () => fail(new Error('failed to load ' + GLUE[i]));
      document.body.appendChild(el);
    })(0);
  });
  return { Module: g.Module, createKws: g.createKws, createVad: g.createVad, tokens };
}

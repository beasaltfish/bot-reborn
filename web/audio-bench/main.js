// The audio bench's entry point: load the wasm, hold the microphone, hand both
// to the panels. Wiring only — every decision belongs to a panel or to the
// product module the panel is driving (spec §10).
//
// An entry file, so it may touch document/navigator at the top level.

import { loadConfig } from '../config.js';
import { AudioPipeline } from '../audio/pipeline.js';
import { loadSherpa } from '../audio/sherpa.js';
import { unknownTokens } from '../audio/keyword-lines.js';
import { createLog, setStat, setDisabled } from './readout.js';
import { createKnobs } from './knobs.js';
import { createResidency } from './residency.js';
import { createAcoustics } from './acoustics.js';
import { createRecognition } from './recognition.js';
import { createProviders } from './providers.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const log = createLog($('log'));
const config = loadConfig();
const knobs = createKnobs({ log });

/** @type {import('../audio/sherpa.js').Sherpa | null} */ let sherpa = null;
/** @type {string} */ let keywords = '';
/** @type {AudioPipeline | null} */ let pipeline = null;

/**
 * Panels register here. Each one is handed everything it could need and takes
 * what it uses; a panel never reaches for a global.
 * @type {Array<{ name: string, start(ctx: BenchContext): void, stop(): void }>}
 */
const PANELS = [
  createResidency(), createAcoustics(), createRecognition(), createProviders(),
];

/**
 * @typedef {{
 *   pipeline: AudioPipeline,
 *   sherpa: import('../audio/sherpa.js').Sherpa,
 *   keywords: string,
 *   config: import('../config.js').Config,
 *   log: (msg: string) => void,
 *   exclusion: ReturnType<typeof import('./knobs.js').createExclusion>,
 *   knobs: ReturnType<typeof import('./knobs.js').createKnobs>,
 * }} BenchContext
 */

// --- Boot: the model and the keyword files, before any user gesture --------

(async () => {
  try {
    sherpa = await loadSherpa((s) => s && setStat('boot', s));
    // §5.5 / docs/hardware.md: an unknown token does not fail quietly — it
    // calls SHERPA_ONNX_EXIT(-1) and aborts the whole wasm module, and the page
    // has to be reloaded. Check before anything reaches createKws().
    keywords = (await Promise.all(
      ['keywords/name.txt', 'keywords/stop.txt']
        .map((p) => fetch(p).then((r) => r.text())),
    )).join('\n');
    const bad = unknownTokens(keywords, sherpa.tokens);
    if (bad.length) throw new Error('unknown tokens in the keyword files: ' + bad.join(' '));
    setStat('boot', 'Model loaded. Press Start.');
    setDisabled('start', false);
  } catch (err) {
    setStat('boot', '❌ ' + /** @type {Error} */ (err).message);
  }
})();

if (!config.stt.baseURL || !config.llm.baseURL || !config.tts.baseURL) {
  setStat('cfgWarn', 'No providers configured — set them up on setup.html first. '
    + 'The residency and acoustics panels still run; recognition and providers do not.');
}

// --- Start / stop ----------------------------------------------------------

$('start').addEventListener('click', async () => {
  if (!sherpa) return;
  setDisabled('start', true);
  setDisabled('aec', true);
  setDisabled('ns', true);
  try {
    const echoCancellation =
      /** @type {HTMLInputElement} */ ($('aec')).checked;
    const noiseSuppression =
      /** @type {HTMLInputElement} */ ($('ns')).checked;
    pipeline = await AudioPipeline.start({
      echoCancellation,
      noiseSuppression,
      onRate: (hz) => log(`AudioContext ${hz} Hz`),
    });
    log(`▶︎ microphone open, echoCancellation ${echoCancellation ? 'on' : 'off'}`
      + `, noiseSuppression ${noiseSuppression ? 'on' : 'off'}`);
    /** @type {BenchContext} */
    const ctx = {
      pipeline, sherpa, keywords, config, log,
      exclusion: knobs.exclusion, knobs,
    };
    for (const panel of PANELS) panel.start(ctx);
    setDisabled('stop', false);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log('❌ ' + (e.name === 'NotAllowedError'
      ? 'microphone permission was refused' : e.message));
    setDisabled('start', false);
    setDisabled('aec', false);
  }
});

$('stop').addEventListener('click', () => {
  for (const panel of PANELS) panel.stop();
  pipeline?.stop();
  pipeline = null;
  setDisabled('stop', true);
  setDisabled('start', false);
  setDisabled('aec', false);
  log('■ stopped');
});

// Option B's one open question. The state machine wants noiseSuppression off
// in SLEEPING (only KWS runs there, and the VAD is unsubscribed, so the AEC
// bursts cannot reach anything) and on everywhere else — but it would switch
// at the SLEEPING → LISTENING edge, which is the instant the wake word fires,
// and a hole there lands on 「往」. Press this mid-run to find out what the
// switch costs before any of it reaches session.js.
$('nsToggle').addEventListener('click', async () => {
  if (!pipeline) { log('start the microphone first'); return; }
  const want = !(/** @type {HTMLInputElement} */ ($('ns')).checked);
  setDisabled('nsToggle', true);
  log(`⇄ asking the live track for noiseSuppression ${want ? 'on' : 'off'}…`);
  const r = await pipeline.reprocess({ noiseSuppression: want });
  /** @type {HTMLInputElement} */ ($('ns')).checked = Boolean(r.settings.noiseSuppression);
  log(`⇄ ${r.took ? `took via the ${r.took} form` : 'DID NOT TAKE'}`
    + `${r.error ? ` (last attempt refused: ${r.error})` : ''}`
    + `, track now reports noiseSuppression `
    + `${r.settings.noiseSuppression ? 'on' : 'off'}`
    + `, gap ${r.gap} frame(s) over ${r.ms} ms`);
  setDisabled('nsToggle', false);
});

$('copyLog').addEventListener('click', () => {
  navigator.clipboard.writeText($('log').textContent ?? '')
    .then(() => log('log copied'))
    .catch((err) => log('copy failed: ' + err.message));
});

export { PANELS, log };

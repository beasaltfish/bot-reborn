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
import { HEADLINES } from './headlines.js';
import { createResidency } from './residency.js';
import { createAcoustics } from './acoustics.js';
import { createRecognition } from './recognition.js';
import { createProviders } from './providers.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const log = createLog($('log'));
const config = loadConfig();

/**
 * Exactly one panel is in the document's flow at a time. They used to all be
 * there with the idle ones dimmed, and dimming saves no scrolling: on a phone
 * the other three are still several screens you travel through.
 *
 * @param {string} name
 */
function showPanel(name) {
  for (const section of document.querySelectorAll('section[id^="panel-"]')) {
    /** @type {HTMLElement} */ (section).hidden = section.id !== `panel-${name}`;
  }
}

/** @type {ReturnType<typeof setInterval> | null} */ let mirrorTimer = null;

/**
 * The bar shows the running panel's headline readings, refreshed four times a
 * second. Polling rather than pushing: every panel already writes its numbers
 * through setStat(), and threading a second sink through four panels to save
 * four reads a second would be paying in coupling for nothing.
 *
 * @param {string | null} owner
 */
function mirror(owner) {
  if (mirrorTimer !== null) { clearInterval(mirrorTimer); mirrorTimer = null; }
  const bar = $('benchbarRead');

  // Put a hoisted element back BEFORE clearing the bar, or clearing destroys
  // it. #acBar belongs between the Abort button and the first stat row, which
  // is where it sits in the markup.
  const hoisted = bar.firstElementChild;
  if (hoisted && hoisted.id === 'acBar') {
    // Back to the top of the card's readings, which is where it sits in the
    // markup. The old target was #acFloor's parent, which stopped being the
    // right neighbour when the panel grew a .card-read around its stat rows.
    const home = $('panel-acoustics').querySelector('.card-read');
    /** @type {HTMLElement} */ (home).prepend(hoisted);
  }
  bar.textContent = '';
  if (!owner) return;

  const spec = HEADLINES[owner];
  if (!spec) return;
  if (!Array.isArray(spec)) {
    // Hoist the element rather than copy its text: it is a display, not a
    // reading. It goes back on release (above), so the panel is whole again
    // when you scroll up to read the stat rows.
    bar.append($(spec.mirror));
    return;
  }
  // The label is the <b> beside the <span>, so the bar says "Keyword hits 3"
  // rather than "3" — three of them side by side, read at a glance.
  const labels = spec.map((id) => /** @type {[string, string]} */ (
    [id, $(id).previousElementSibling?.textContent ?? id]));
  mirrorTimer = setInterval(() => {
    bar.textContent = labels
      .map(([id, label]) => `${label} ${$(id).textContent}`)
      .join('  ·  ');
  }, 250);
}

const knobs = createKnobs({
  log,
  onOwner: (owner) => {
    // Switching away from a running panel would hide the thing that is running
    // and take its readings off the bar with it. Stop it first.
    setDisabled('panelPick', owner !== null);
    mirror(owner);
  },
});

$('panelPick').addEventListener('change', () =>
  showPanel(/** @type {HTMLSelectElement} */ ($('panelPick')).value));
showPanel('residency');

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
// and a hole there lands on the first syllable after the wake word. Press this
// mid-run to find out what the switch costs before any of it reaches
// session.js.
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

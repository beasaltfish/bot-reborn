// Developer options: the one page behind the gear, and the only entry file the
// instruments have.
//
// It owns the three things a page can only have one of — the FT232H, the
// microphone, and the emergency stop — and hands them to the panels. Wiring
// only: every decision belongs to a panel or to the product module the panel is
// driving (spec §10).
//
// The FT232H being owned here is not tidiness. Ftdi.open() calls
// claimInterface(0), so a second open on the same device fails; three pages
// each opening their own was fine while they were three documents and is a bug
// the moment they are one.

import { loadConfig } from './config.js';
import { AudioPipeline } from './audio/pipeline.js';
import { loadSherpa } from './audio/sherpa.js';
import { unknownTokens } from './audio/keyword-lines.js';
import { createLog, setStat, setDisabled } from './panels/readout.js';
import { createKnobs } from './panels/knobs.js';
import { HEADLINES } from './panels/headlines.js';
import { createStatus } from './instrument-status.js';
// eslint-disable-next-line no-unused-vars -- typedef only
/** @typedef {import('./panels/context.js').DevContext} DevContext */
/** @typedef {import('./panels/context.js').AudioContext} AudioContext */
import { createResidency } from './panels/residency.js';
import { createAcoustics } from './panels/acoustics.js';
import { createRecognition } from './panels/recognition.js';
import { createProviders } from './panels/providers.js';
import { createPins } from './panels/pins.js';
import { createConnectivity } from './panels/connectivity.js';
import { Ftdi } from './ftdi.js';
import { Executor } from './executor.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const log = createLog($('log'));

// Five readings, and every one of them was already known somewhere in this
// file or in knobs.js — none of it was ever shown in one place.
const status = createStatus($('instrumentStatus'),
  ['mic', 'usb', 'keepalive', 'motor', 'panel']);
status.set('mic', 'dim', 'mic closed');
status.set('usb', 'dim', 'USB not connected');
status.set('keepalive', 'dim', 'keep-alive off');
status.set('motor', 'dim', 'motor off');
status.set('panel', 'dim', 'idle');
const config = loadConfig();

/**
 * The two panels that never claim the microphone, and never need the model.
 *
 * Declared up here because showPanel() reads it and showPanel runs during this
 * module's own evaluation. It used to sit two hundred lines down, which is a
 * temporal dead zone and therefore a ReferenceError that aborted the module —
 * silently, because a module that throws simply stops: every listener after the
 * throw is never attached, and the page looks fine and does nothing.
 */
const PASSIVE = new Set(['pins', 'connectivity']);

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
  // The microphone constraints and the two cross-cutting knobs belong to all
  // four audio panels at once, so they travel with the group rather than with
  // any one of them.
  $('audioCommon').hidden = PASSIVE.has(name);
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
    // Every tab locks while something runs: switching away would hide the
    // thing that is running and take its readings off the bar with it.
    for (const tab of document.querySelectorAll('#panelTabs .tab')) {
      /** @type {HTMLButtonElement} */ (tab).disabled = owner !== null;
    }
    mirror(owner);
    status.set('panel', owner ? 'go' : 'dim', owner ?? 'idle');
  },
  onStatus: (id, state, label) => status.set(id, state, label),
});

// --- the one FT232H, and the one emergency stop ---------------------------

/** @type {Ftdi | null} */ let ftdi = null;
/** @type {Executor | null} */ let executor = null;

/**
 * One cable, one handle. Two buttons reach it — the pin bench keeps one of its
 * own because wiring up a freshly soldered board is the thing you do before
 * anything else, and making that start in another group would be a detour on
 * the most common path.
 */
async function connect() {
  if (ftdi) { log('already connected'); return; }
  if (!navigator.usb) {
    status.set('usb', 'wait', 'no WebUSB (needs Chrome / Edge)');
    return;
  }
  try {
    // No baudRate and no bytesPerMs: 1200 is ftdi.js's default and every
    // instrument already used it, so the merge changes nothing here. ② is
    // MEASURING bytesPerMs, which is why it must not be handed a calibrated
    // one.
    ftdi = await Ftdi.open(navigator.usb);
    ftdi.onDisconnect = (err) => {
      ftdi = null;
      executor = null;
      status.set('usb', 'dim', 'USB disconnected');
      log('!! ' + err.message);
    };
    executor = new Executor(ftdi, {
      onError: (err) => { status.set('usb', 'wait', '!! ' + err.message); log('executor: ' + err.message); },
    });
    status.set('usb', 'go', 'USB connected');
    setStat('usbStatus', 'Status: connected');
    setDisabled('motorToggle', false);
    log('▶︎ FT232H connected');
  } catch (err) {
    status.set('usb', 'wait', 'USB connect failed');
    log('❌ ' + /** @type {Error} */ (err).message);
  }
}

for (const id of ['connectBtn', 'pinsConnectBtn', 'usbConnect']) {
  $(id).addEventListener('click', () => void connect());
}

/**
 * docs/ui.md's "The one button": one button, one fixed place, whose face is
 * always the most urgent thing available. Red exists on this page only while
 * the car might be moving, which is what makes reserving it true rather than
 * merely stated.
 *
 * Three things set the car going and each arms it: the motor toggle (⑦), a pin
 * button, and the typed driver.
 *
 * @param {boolean} on
 */
function armStop(on) {
  $('stopBtn').hidden = !on;
  for (const b of ['start', 'stop']) $(b).hidden = on;
}

$('stopBtn').addEventListener('click', async () => {
  // Both halves, because the two used to live in two pages and each knew only
  // its own: purge what is queued, then pull the pins low. A stop that only
  // did the second would still have twenty seconds of bytes behind it.
  try { await ftdi?.purgeTx(); } catch { /* the pins still have to go low */ }
  executor?.stop();
  armStop(false);
  log('■ emergency stop');
});

/** @param {string} picked */
function pickPanel(picked) {
  showPanel(picked);
  for (const tab of document.querySelectorAll('#panelTabs .tab')) {
    const el = /** @type {HTMLElement} */ (tab);
    el.setAttribute('aria-selected', String(el.dataset.panel === picked));
  }
  if (NEEDS_MODEL.has(picked)) void ensureSherpa();
}

for (const tab of document.querySelectorAll('#panelTabs .tab')) {
  const el = /** @type {HTMLElement} */ (tab);
  el.addEventListener('click', () => pickPanel(/** @type {string} */ (el.dataset.panel)));
}
showPanel('pins');



/** @type {import('./audio/sherpa.js').Sherpa | null} */ let sherpa = null;
/** @type {string} */ let keywords = '';
/** @type {AudioPipeline | null} */ let pipeline = null;

/**
 * Panels register here. Each one is handed everything it could need and takes
 * what it uses; a panel never reaches for a global.
 * @type {Array<{ name: string, start(ctx: AudioContext): void, stop(): void }>}
 */
/** The two that never touch the microphone. They start at once. */
const PASSIVE_PANELS = [createPins(), createConnectivity()];

/** The four that share it. They start when Start opens the pipeline. */
const AUDIO_PANELS = [
  createResidency(), createAcoustics(), createRecognition(), createProviders(),
];

/**
 * The two that never claim the exclusion, and never need the model.
 *
 * Exclusion was always about the microphone — "two panels measuring at once
 * would each be measuring the other" — and these two do not touch it. They also
 * have to be able to run WHILE an audio panel does: ⑦ is KWS measured against
 * the motor's own noise.
 */


// --- The model, the first time an audio panel is chosen --------------------

/** @type {Promise<import('./audio/sherpa.js').Sherpa> | null} */
let sherpaLoad = null;

/**
 * 18 MB, fetched once and never again.
 *
 * It used to run at import. That was free while this page was only the audio
 * bench; on a page that also holds the pin bench and the connectivity test it
 * would make the two tools you reach for when NOTHING works yet wait for the
 * heaviest asset in the project.
 *
 * Cached as a promise rather than a flag: two panels chosen in quick succession
 * must not start two downloads, and loadSherpa's failure is permanent — the
 * glue is a classic script, injecting it twice is a SyntaxError, and after that
 * onRuntimeInitialized never fires and the page waits in silence
 * (docs/hardware.md).
 */
function ensureSherpa() {
  if (sherpaLoad) return sherpaLoad;
  sherpaLoad = (async () => {
    const loaded = await loadSherpa((msg) => msg && setStat('boot', msg));
    // §5.5 / docs/hardware.md: an unknown token does not fail quietly — it
    // calls SHERPA_ONNX_EXIT(-1) and aborts the whole wasm module, and the page
    // has to be reloaded. Check before anything reaches createKws().
    keywords = (await Promise.all(
      ['keywords/name.txt', 'keywords/stop.txt']
        .map((p) => fetch(p).then((r) => r.text())),
    )).join('\n');
    const bad = unknownTokens(keywords, loaded.tokens);
    if (bad.length) throw new Error('unknown tokens in the keyword files: ' + bad.join(' '));
    sherpa = loaded;
    setStat('boot', 'Model loaded. Press Start.');
    setDisabled('start', false);
    return loaded;
  })();
  sherpaLoad.catch((err) => setStat('boot', '❌ ' + /** @type {Error} */ (err).message));
  return sherpaLoad;
}

/** The four panels that need it. Pins and connectivity never do. */
const NEEDS_MODEL = new Set(['residency', 'acoustics', 'recognition', 'providers']);

if (!config.stt.baseURL || !config.llm.baseURL || !config.tts.baseURL) {
  setStat('cfgWarn', 'No providers configured — set them up on dev.html first. '
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
      onRate: (hz) => {
        log(`AudioContext ${hz} Hz`);
        status.set('mic', 'go', `mic ${hz / 1000} kHz`);
      },
    });
    log(`▶︎ microphone open, echoCancellation ${echoCancellation ? 'on' : 'off'}`
      + `, noiseSuppression ${noiseSuppression ? 'on' : 'off'}`);
    /** @type {AudioContext} */
    /** @type {AudioContext} */
    const ctx = {
      pipeline, sherpa, keywords, config, log,
      status: (id, state, label) => status.set(id, state, label),
      exclusion: knobs.exclusion, knobs,
      get ftdi() { return ftdi; },
      get executor() { return executor; },
      armStop,
    };
    for (const panel of AUDIO_PANELS) panel.start(ctx);
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
  for (const panel of AUDIO_PANELS) panel.stop();
  pipeline?.stop();
  pipeline = null;
  setDisabled('stop', true);
  setDisabled('start', false);
  setDisabled('aec', false);
  status.set('mic', 'dim', 'mic closed');
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


/**
 * The two passive panels start immediately: their `start` only attaches
 * listeners, and the tools you reach for when nothing works yet must not wait
 * for a microphone or for 18 MB of wasm. The four audio panels start on Start,
 * where a non-null pipeline and sherpa exist for them.
 */
for (const panel of PASSIVE_PANELS) {
  panel.start(/** @type {DevContext} */ ({
    pipeline: null, sherpa: null, keywords: '', config, log,
    status: (id, state, label) => status.set(id, state, label),
    exclusion: knobs.exclusion, knobs,
    get ftdi() { return ftdi; },
    get executor() { return executor; },
    armStop,
  }));
}

export { PASSIVE_PANELS, AUDIO_PANELS, log };

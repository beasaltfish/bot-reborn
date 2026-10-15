// Developer options, as a body has them: the pin bench. It owns the two things
// a page can only have one of — the FT232H and the emergency stop — and hands
// them to the panel. The audio instruments measured engines that run on the
// brain now (server/body split spec §4) and left with them; git history has
// them.

import { createLog, setStat } from './panels/readout.js';
import { createStatus } from './instrument-status.js';
import { createPins } from './panels/pins.js';
import { Ftdi } from './ftdi.js';
import { Executor } from './executor.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const log = createLog($('log'));
const status = createStatus($('instrumentStatus'), ['usb']);
status.set('usb', 'dim', 'USB not connected');

/** @type {Ftdi | null} */ let ftdi = null;
/** @type {Executor | null} */ let executor = null;

/**
 * The pin bench's "Status:" line, written from the one place the cable is
 * opened and lost.
 * @param {string} text
 */
function cableStatus(text) {
  for (const id of ['status']) setStat(id, `Status: ${text}`);
}

async function connect() {
  if (ftdi) { log('already connected'); return; }
  if (!navigator.usb) {
    status.set('usb', 'wait', 'no WebUSB (needs Chrome, and a secure page)');
    cableStatus('this browser has no WebUSB here');
    return;
  }
  try {
    // No bytesPerMs: ② is MEASURING it, so it must not be handed a calibrated one.
    ftdi = await Ftdi.open(navigator.usb);
    ftdi.onDisconnect = (err) => {
      ftdi = null;
      executor = null;
      status.set('usb', 'dim', 'USB disconnected');
      cableStatus('disconnected');
      armStop(false);
      log('!! ' + err.message);
    };
    executor = new Executor(ftdi, {
      onError: (err) => { status.set('usb', 'wait', '!! ' + err.message); log('executor: ' + err.message); },
    });
    status.set('usb', 'go', 'USB connected');
    cableStatus('connected');
    log('▶︎ FT232H connected');
  } catch (err) {
    status.set('usb', 'wait', 'USB connect failed');
    cableStatus(/** @type {Error} */ (err).message);
    log('❌ ' + /** @type {Error} */ (err).message);
  }
}

$('pinsConnectBtn').addEventListener('click', () => void connect());

/**
 * Red exists on this page only while the car might be moving.
 * @param {boolean} on
 */
function armStop(on) { $('stopBtn').hidden = !on; }

$('stopBtn').addEventListener('click', async () => {
  // Purge what is queued, then pull the pins low.
  try { await ftdi?.purgeTx(); } catch { /* the pins still have to go low */ }
  executor?.stop();
  armStop(false);
  log('■ emergency stop');
});

$('copyLog').addEventListener('click', () => {
  navigator.clipboard.writeText($('log').textContent ?? '')
    .then(() => log('log copied'))
    .catch((err) => log('copy failed: ' + err.message));
});

createPins().start({
  log,
  status: (id, state, label) => status.set(id, state, label),
  get ftdi() { return ftdi; },
  get executor() { return executor; },
  armStop,
});

export { log };

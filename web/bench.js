// The calibration bench — the bring-up panel for spec §12's ①②⑧.
//
// It stands in for web/app.js (D4/D5, one byte at a time), whose model cannot
// express "write 3000 bytes and then start a stopwatch". Here Ftdi.buildStream()
// hands the whole buffer over in one go instead.
//
// This page is not a throwaway demo: bytesPerMs gets re-calibrated whenever the
// hardware changes, so it lives in the repo permanently.
//
// An entry file: allowed to touch document/navigator at the top level (spec
// §10's exception).

import { Ftdi, encodeBaudRate, PIN_MASK, FTDI_VID, FT232H_PID } from './ftdi.js';

const BENCH_BAUD = 1200; // the calibration baud rate spec §12 ② specifies
const BYTE_RATE_TEST_BYTES = 3000;

/** @type {Ftdi | null} */
let ftdi = null;

// --- Typed DOM helpers (Ruling P2: stay strict, no @ts-nocheck) -------------

const el = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const inputEl = (/** @type {string} */ id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));

const statusEl = el('status');
const logEl = el('log');

/** The log's real content lives in this string. `logEl.textContent` is typed
 *  `string | null`, so a read-modify-write through it does not survive strict
 *  mode — this only ever writes to the element. */
let logText = '';

/** @param {string} text */
function setStatus(text) {
  statusEl.textContent = `Status: ${text}`;
}

/** @param {string} text */
function log(text) {
  const time = new Date().toISOString().slice(11, 19);
  logText += `[${time}] ${text}\n`;
  logEl.textContent = logText;
  logEl.scrollTop = logEl.scrollHeight;
}

/** @param {number} n @param {number} [width] */
function hex(n, width = 4) {
  return `0x${n.toString(16).padStart(width, '0')}`;
}

/** @param {number} n */
function bin8(n) {
  return `0b${n.toString(2).padStart(8, '0')}`;
}

/** The connected Ftdi, or null with the status set — callers just write
 *  `if (!dev) return;`.
 *  @returns {Ftdi | null} */
function requireFtdi() {
  if (!ftdi) {
    setStatus('connect the device first');
    return null;
  }
  return ftdi;
}

// --- Diagnostics lifted from app.js (verbatim, except the pin width grew
// --- from D4/D5 to D4-D7) ---------------------------------------------------

/** @param {USBDevice} d */
function describeDevice(d) {
  const lines = [
    `  VID:PID      ${hex(d.vendorId)}:${hex(d.productId)}`,
    `  manufacturer ${d.manufacturerName || '(none)'}`,
    `  product      ${d.productName || '(none)'}`,
    `  serial       ${d.serialNumber || '(none)'}`,
    `  usbVersion   ${d.usbVersionMajor}.${d.usbVersionMinor}`,
    `  configs      ${d.configurations.length}`,
  ];

  for (const config of d.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        const endpoints = alt.endpoints
          .map((e) => `${e.direction}#${e.endpointNumber}(${e.type})`)
          .join(' ');
        lines.push(
          `  cfg${config.configurationValue} if${iface.interfaceNumber}` +
            ` class=${hex(alt.interfaceClass, 2)} ep: ${endpoints || '(none)'}`
        );
      }
    }
  }

  return lines.join('\n');
}

// Diagnostics only. Ftdi.open() discovers the bulk OUT endpoint again on its
// own, and that is the one the protocol layer actually writes through. This
// repeats the same search purely so the endpoint number reaches the log at
// connect time, for the "board is attached but the endpoint is wrong" class of
// problem.
/** @param {USBDevice} d @returns {number | null} */
function findBulkOutEndpoint(d) {
  for (const config of d.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out' && ep.type === 'bulk') return ep.endpointNumber;
        }
      }
    }
  }
  return null;
}

/** @param {Ftdi} dev */
async function logPinState(dev) {
  const value = await dev.readPins();
  const d4 = (value >> 4) & 1, d5 = (value >> 5) & 1;
  const d6 = (value >> 6) & 1, d7 = (value >> 7) & 1;
  log(`read pins: ${bin8(value)}  D4=${d4} D5=${d5} D6=${d6} D7=${d7}`);
  return value;
}

function reportEnvironment() {
  log(`secure context: ${window.isSecureContext}`);
  log(`origin: ${location.origin}`);
  log(`WebUSB available: ${'usb' in navigator}`);
  log(`userAgent: ${navigator.userAgent}`);

  if (!navigator.usb) {
    log('');
    log('!! navigator.usb is missing. WebUSB needs a Chromium-based browser');
    log('   (Chrome / Edge). Firefox, Safari and iOS do not support it.');
    setStatus('this browser has no WebUSB');
  }
  log('');
}

// --- Connect -----------------------------------------------------------------

el('connectBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) {
    setStatus('this browser has no WebUSB');
    return;
  }

  try {
    log(`requesting a device matching ${hex(FTDI_VID)}:${hex(FT232H_PID)} ...`);
    const device = await usb.requestDevice({
      filters: [{ vendorId: FTDI_VID, productId: FT232H_PID }],
    });

    log('device selected:');
    log(describeDevice(device));

    const endpoint = findBulkOutEndpoint(device);
    log(`bulk OUT endpoint (diagnostic): ${endpoint === null ? 'not found' : endpoint}`);

    const opened = await Ftdi.open(usb, { baudRate: BENCH_BAUD, device });
    opened.onDisconnect = (err) => {
      ftdi = null;
      log(`!! device disconnected: ${err.message}`);
      setStatus('disconnected');
    };
    ftdi = opened;

    // encodeBaudRate's actualBaud is the rate the divisor can actually land on,
    // which need not equal the requested one. ②'s "theoretical duration" is
    // computed from BENCH_BAUD, so the gap between the two is printed here —
    // otherwise a later ms/byte figure comes out skewed with no way to tell
    // whether the divisor is to blame.
    const { actualBaud } = encodeBaudRate(BENCH_BAUD);
    log(`connected at ${BENCH_BAUD} baud (async bitbang, D4-D7 as outputs), ` +
      `divisor lands on ${actualBaud}, bytesPerMs=${opened.bytesPerMs}`);
    log('pin state after entering bitbang mode:');
    await logPinState(opened);

    setStatus('FT232H connected');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    setStatus(`connect failed: ${e.message}`);
  }
});

// --- Emergency stop (spec §4.1 layer 2) --------------------------------------
//
// This page does not go through the Executor, so there is no generation counter
// to preempt — and none is needed: no renewal loop is running here, and the
// entire danger is the pile of bytes already handed to the chip and not yet
// played out. So the emergency stop is just steps 2 and 3 of spec §4.4, in the
// same non-negotiable order: purgeTx throws away what is queued in the FIFO,
// then a single 0x00 pulls the pins low. The other way round, the purge takes
// the 0x00 with it. ②'s 3000 bytes run for 20 seconds; without this button the
// only recourse is unplugging the cable.

el('stopBtn').addEventListener('click', async () => {
  const dev = requireFtdi();
  if (!dev) return;
  try {
    await dev.purgeTx();
    await dev.write(new Uint8Array([0x00]));
    log('■ emergency stop: purgeTx dropped the queued bytes, then 0x00 pulled the pins low');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! emergency stop failed ${e.name}: ${e.message} — unplug the cable`);
    setStatus(`emergency stop failed: ${e.message}`);
  }
});

// --- ① the six pin combinations: which of side A / B is left --------------

for (const button of document.querySelectorAll('[data-pins]')) {
  const btn = /** @type {HTMLElement} */ (button);
  btn.addEventListener('click', async () => {
    const dev = requireFtdi();
    if (!dev) return;

    const pins = Number(btn.dataset.pins);
    log(`--- ${bin8(pins)} held for 600 ms ---`);
    try {
      // One transferOut, stop byte already inside the same buffer — spec §4.2.
      await dev.write(dev.buildStream(pins, 600));

      // Mind the timing. 3000 bytes at 1200 baud run for a dozen seconds, but
      // this writes only 600 ms, which drains quickly at the calibration rate —
      // so by read-back time the pins may already have fallen to 0x00 on their
      // own. That case is reported as ambiguous rather than as a MISMATCH,
      // because it is usually just a normal ending. A chip genuinely stuck low
      // reads back the same 0x00 though, which is why the log is not skipped
      // altogether: the conclusion is what has to be withheld, not the
      // evidence.
      const readback = await dev.readPins();
      if ((readback & PIN_MASK) === (pins & PIN_MASK)) {
        log('=> the chip really is driving the pins as asked. If the car does not move, the fault is downstream: wiring, driver chip, or driver supply.');
      } else if (readback === 0x00) {
        log(`=> ⚠️ AMBIGUOUS: wrote ${bin8(pins)}, read back 0x00.`);
        log('   A 600 ms slice can have drained on its own at this baud rate, which is not a fault;');
        log('   but pins stuck low read back the same 0x00. This number alone cannot separate the two — watch what the car did.');
      } else {
        log(`=> MISMATCH: wrote ${bin8(pins)}, read back ${bin8(readback)}.`);
        log('   The chip is not driving the pins as asked — a bitbang-mode or baud-rate problem, not a wiring one.');
      }
    } catch (err) {
      const e = /** @type {Error} */ (err);
      log(`!! ${e.name}: ${e.message}`);
      setStatus(`write failed: ${e.message}`);
    }
  });
}

// --- ② the byte-rate and road-speed experiment -------------------------------

el('byteRateBtn').addEventListener('click', async () => {
  const dev = requireFtdi();
  if (!dev) return;

  // Spec §12 ② asks for an exact 3000-byte buffer here, not the byte count
  // buildStream() would estimate from bytesPerMs — bytesPerMs is the thing
  // being measured, and feeding the estimate back in would make the experiment
  // measure its own assumption.
  const stream = new Uint8Array(BYTE_RATE_TEST_BYTES + 1);
  stream.fill(0x10, 0, BYTE_RATE_TEST_BYTES);
  stream[BYTE_RATE_TEST_BYTES] = 0x00;

  const theory = (BYTE_RATE_TEST_BYTES * 8) / BENCH_BAUD; // seconds, at 8 bit/byte
  log(`writing ${BYTE_RATE_TEST_BYTES} bytes @ ${BENCH_BAUD} baud, theory says ${theory.toFixed(1)} s`);
  log('start the stopwatch now — from the motor starting to the motor stopping. Measure how far the car went, too.');
  try {
    const t0 = performance.now();
    await dev.write(stream);
    log(`transferOut returned after ${(performance.now() - t0).toFixed(0)} ms`);
    log('(that number is how long submitting the URB took, not how long the motor ran — the stopwatch is.)');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    setStatus(`write failed: ${e.message}`);
  }
});

el('computeBtn').addEventListener('click', () => {
  const seconds = Number(inputEl('measuredSeconds').value);
  const metres = Number(inputEl('measuredMetres').value);
  if (!seconds) return;

  const theory = (BYTE_RATE_TEST_BYTES * 8) / BENCH_BAUD;
  const msPerByte = (seconds * 1000) / BYTE_RATE_TEST_BYTES;
  const out = [
    `measured ${seconds} s / theory ${theory.toFixed(1)} s = ratio ${(seconds / theory).toFixed(3)}`,
    `${msPerByte.toFixed(3)} ms per byte  →  bytesPerMs = ${(1 / msPerByte).toFixed(4)}`,
    msPerByte >= 2 && msPerByte <= 5
      ? '✅ inside spec §12 2\'s target band of 2-5 ms/byte'
      : '⚠️ outside the 2-5 ms/byte target band — the baud rate or the divisor encoding is probably wrong; do not go further yet',
  ];
  if (metres) {
    const speed = metres / seconds;
    out.push(`road speed ${speed.toFixed(2)} m/s  →  at MAX_COAST_MS=1000 the coast is ${speed.toFixed(2)} m`);
    out.push(Math.abs(speed - 1.5) < 0.7
      ? '✅ agrees with spec §4.3, "about 1.5 m"'
      : '⚠️ far from spec §4.3\'s "about 1.5 m" — MAX_COAST_MS needs re-checking');
  }
  el('byteRateResult').textContent = out.join('\n');
  log(out.join('\n'));
});

// --- ⑧ the motor's starting threshold ----------------------------------------

for (const button of document.querySelectorAll('[data-pulse]')) {
  const btn = /** @type {HTMLElement} */ (button);
  btn.addEventListener('click', async () => {
    const dev = requireFtdi();
    if (!dev) return;

    const ms = Number(btn.dataset.pulse);
    try {
      await dev.write(dev.buildStream(0x10, ms));
      log(`⑧ pulse of ${ms} ms — did the car move? (it only counts if all 10 tries do)`);
    } catch (err) {
      const e = /** @type {Error} */ (err);
      log(`!! ${e.name}: ${e.message}`);
      setStatus(`write failed: ${e.message}`);
    }
  });
}

// --- Diagnostics -------------------------------------------------------------

// An empty filter lists every USB device the browser can see. It answers
// whether the board enumerated at all, and under which VID:PID — the first
// thing to check when the picker stays empty.
el('scanAllBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) return;

  try {
    log('opening an unfiltered picker (every device) ...');
    const found = await usb.requestDevice({ filters: [] });
    log('device selected:');
    log(describeDevice(found));

    if (found.vendorId === FTDI_VID && found.productId === FT232H_PID) {
      log('=> matches the FT232H filter; the picker should have listed it.');
    } else {
      log(`=> does not match the ${hex(FTDI_VID)}:${hex(FT232H_PID)} filter.`);
      log('   That is why it never appeared — the filter needs updating.');
    }
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    if (e.name === 'NotFoundError') {
      log('   NotFoundError = the picker was dismissed without choosing anything.');
      log('   If the list itself was empty, the phone never enumerated the board at all');
      log('   (an OTG power, cable, or Android permission problem).');
    }
  }
});

el('readPinsBtn').addEventListener('click', async () => {
  const dev = requireFtdi();
  if (!dev) return;
  try {
    await logPinState(dev);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    log(`!! ${e.name}: ${e.message}`);
    setStatus(`reading the pins failed: ${e.message}`);
  }
});

el('listGrantedBtn').addEventListener('click', async () => {
  const usb = navigator.usb;
  if (!usb) return;

  const devices = await usb.getDevices();
  log(`previously granted devices: ${devices.length}`);
  for (const d of devices) log(describeDevice(d));
});

el('copyLogBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logText);
    setStatus('log copied to the clipboard');
  } catch {
    setStatus('copy failed — select the log text by hand');
  }
});

reportEnvironment();

// The calibration bench — the bring-up panel for spec §12's ①②⑧.
//
// It stands in for web/app.js (D4/D5, one byte at a time), whose model cannot
// express "write 3000 bytes and then start a stopwatch". Here Ftdi.buildStream()
// hands the whole buffer over in one go instead.
//
// This page is not a throwaway demo: bytesPerMs gets re-calibrated whenever the
// hardware changes, so it lives in the repo permanently.
//
// No longer an entry file. It used to attach eleven listeners at module scope,
// which is not available on a page that holds all three instruments at once —
// and the audio panels have had this shape since the bench was written, so this
// is catching up rather than inventing.

import {
  encodeBaudRate, PIN_MASK, FTDI_VID, FT232H_PID, DEFAULT_BYTES_PER_MS,
} from '../ftdi.js';
import { MIN_DURATION_MS } from '../executor.js';
import { setDisabled, setStat } from './readout.js';

const BENCH_BAUD = 1200; // the calibration baud rate spec §12 ② specifies
const BYTE_RATE_TEST_BYTES = 3000;

/**
 * ② writes three lengths, not one, and the answer is in whether they scale.
 *
 * One length cannot tell a rate from a cap: 3000 bytes that ran for 0.46 s is
 * either a chip five times faster than assumed, or 550 bytes of a 3000-byte
 * write that never arrived. Double the request and the two part company — a
 * real rate doubles the run, a cap does not move it.
 */
const BYTE_RATE_SWEEP = [1500, 3000, 6000];

/**
 * The other axis. The byte sweep says the run scales with the bytes; it cannot
 * say whether the baud request is being honoured at all — a chip that ignored
 * it and free-ran at one fixed clock would produce exactly the same three
 * proportional runs. Ask for three bauds and the two part company: if the rate
 * is a multiple of what it was asked for, these scale; if the request is being
 * ignored, all three come back the same.
 */
const BAUD_SWEEP = [600, 1200, 2400];

/**
 * How many times a pulse length has to move the car before it counts.
 *
 * Ten, because near the threshold the answer is not yes or no but a
 * probability: the wheels break loose from wherever they happened to stop. A
 * length that works nine times out of ten is a length the product cannot use,
 * and is exactly the length a shorter procedure would have accepted.
 */
const TRIES_PER_PULSE = 10;

/**
 * How often ② asks the chip what its pins are doing, in ms. This interval IS
 * the reading's resolution: 20 ms of a 2.5 s run is under 1%, where a stopwatch
 * in a hand is nearer 200 ms — which on a run this short was most of the
 * reading.
 */
const PIN_POLL_MS = 20;

/**
 * How many lows in a row end the polling. One low read does not: a dip in the
 * middle of a run is exactly the thing ② has to be able to see rather than be
 * fooled by.
 */
const SETTLE_READS = 10;

// --- Typed DOM helpers (Ruling P2: stay strict, no @ts-nocheck) -------------

const el = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

const inputEl = (/** @type {string} */ id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));

/**
 * Every read of the pins, from just before the write until the run has settled.
 *
 * readPins() reports the pin state the last clocked-out byte left behind, so
 * the whole run is in here: what it drove, for how long, and — the reason this
 * returns the trace rather than a number — whether it ever dipped low in the
 * middle. A rule that stopped at the first low read would turn one glitched
 * read into a short measurement, and a short measurement is indistinguishable
 * from a fast chip.
 *
 * The write is deliberately not awaited before the polling starts: at this baud
 * rate the transfer drains only as fast as the chip plays it out, so awaiting it
 * first would start the clock after the thing being timed had already finished.
 *
 * Exported, and at module scope, because it is the only part of this panel that
 * is a measurement rather than a wiring: it takes a device and gives back
 * numbers, and that can be tested without a document.
 *
 * @param {import('../ftdi.js').Ftdi} dev
 * @param {Uint8Array<ArrayBuffer>} stream
 * @param {{ pollMs?: number, timeoutMs?: number, settleReads?: number }} [opts]
 * @returns {Promise<{ reads: Array<[number, number]>, wrote: number | null }>}
 *   `reads` is [ms since the write started, pins]; `wrote` is what the host says
 *   it sent, which is the other half of a run that comes out too short.
 */
export async function traceTheRun(dev, stream, opts = {}) {
  /** @type {unknown} */ let writeError;
  /** @type {number | null} */ let wrote = null;
  const t0 = performance.now();
  const writing = dev.write(stream)
    .then((n) => { wrote = typeof n === 'number' ? n : null; })
    .catch((err) => { writeError = err; });

  const pollMs = opts.pollMs ?? PIN_POLL_MS;
  const settle = opts.settleReads ?? SETTLE_READS;
  // Generous, because the whole point of ② is that the rate is not known yet:
  // the losing hypothesis (baud ÷ 8) predicts eight times the theory, and a
  // deadline that assumed the winner would cut the measurement that disproves
  // it. Nothing is driving here that the stop byte will not end anyway.
  const theory = (stream.length - 1) / BENCH_BAUD;
  const deadline = t0 + (opts.timeoutMs ?? theory * 1000 * 12 + 2000);

  /** @type {Array<[number, number]>} */ const reads = [];
  let seenHigh = false;
  let lows = 0;
  while (performance.now() < deadline && !writeError) {
    const pins = await dev.readPins();
    reads.push([Math.round(performance.now() - t0), pins]);
    if ((pins & PIN_MASK) !== 0) { seenHigh = true; lows = 0; }
    else if (seenHigh && ++lows >= settle) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  await writing;
  if (writeError) throw writeError;
  return { reads, wrote };
}

/**
 * What the trace says the run was.
 *
 * `seconds` spans the first high read to the last one, so a dip in the middle
 * cannot shorten it; `toFirstDip` is what the old first-falling-edge rule would
 * have said. When the two disagree, the trace is the evidence and the difference
 * is the whole story — which is why both are reported rather than one.
 *
 * @param {Array<[number, number]>} reads
 */
export function readRun(reads) {
  const highs = reads.filter(([, pins]) => (pins & PIN_MASK) !== 0);
  if (!highs.length) return null;
  const first = highs[0][0];
  const last = highs[highs.length - 1][0];
  const dips = reads.filter(([ms, pins]) => ms > first && ms < last && (pins & PIN_MASK) === 0);
  const gaps = reads.slice(1).map(([ms], i) => ms - reads[i][0]).sort((a, b) => a - b);
  /** The real interval between reads: a control transfer on a phone is not the
   *  20 ms this asked for, and the interval IS the resolution. */
  const poll = gaps.length ? gaps[gaps.length >> 1] : 0;
  return {
    // The span between two reads is the run MINUS however much of it fell
    // before the first high read and after the last one — up to one poll at
    // each end, so the true run is somewhere in [span, span + 2 × poll]. The
    // middle of that is span + poll, and taking the bare span instead biased
    // every reading short: it is what made the first sweep report 5.23× a
    // rate that the same numbers put at 5.0 once the bias is taken out.
    seconds: (last - first + poll) / 1000,
    toFirstDip: dips.length ? (dips[0][0] - first) / 1000 : (last - first + poll) / 1000,
    dips: dips.length,
    pollMs: poll,
    reads: reads.length,
  };
}

/**
 * The trace itself, run-length encoded: `_×2 #×118 _×1 #×6 _×10`. Two lines of
 * log that answer "did it stop, or did one read lie?" without anybody having to
 * read a hundred numbers.
 *
 * @param {Array<[number, number]>} reads
 */
export function pinTrace(reads) {
  /** @type {Array<[string, number]>} */ const runs = [];
  for (const [, pins] of reads) {
    const ch = (pins & PIN_MASK) !== 0 ? '#' : '_';
    const last = runs[runs.length - 1];
    if (last && last[0] === ch) last[1] += 1;
    else runs.push([ch, 1]);
  }
  return runs.map(([ch, n]) => (n === 1 ? ch : `${ch}×${n}`)).join(' ');
}

/**
 * What the ⑧ tally says the threshold is.
 *
 * `threshold` is the shortest length that moved the car every single time out
 * of TRIES_PER_PULSE. `unfinished` is what stands between that answer and a
 * shorter one: a length below the threshold that has not been tried enough
 * times has not been ruled out, and reporting the threshold without saying so
 * would turn "nobody tested 150" into "150 does not work".
 *
 * @param {Map<number, { tries: number, hits: number }>} trials
 * @param {number} [need]
 */
export function summariseTrials(trials, need = TRIES_PER_PULSE) {
  const lengths = [...trials.keys()].sort((a, b) => a - b);
  const rows = lengths.map((ms) => {
    const { tries, hits } = /** @type {{tries: number, hits: number}} */ (trials.get(ms));
    return {
      ms, tries, hits,
      passed: tries >= need && hits === tries,
      // Tried enough and missed at least once: this length is settled, and
      // settled as a no.
      settled: tries >= need,
    };
  });
  const passed = rows.filter((r) => r.passed);
  const threshold = passed.length ? passed[0].ms : null;
  const unfinished = rows.filter((r) => !r.settled && (threshold === null || r.ms < threshold));
  return { rows, threshold, unfinished };
}

const NAME = 'pins';

/**
 * The pin bench: spec §12's ① ② ⑧, plus the USB diagnostics.
 *
 * It never claims the exclusion. It does not touch the microphone, and ⑦ is
 * measured with the motor running WHILE an audio panel runs, so the two have to
 * be able to coexist.
 */
export function createPins() {
  /** @type {import('./context.js').DevContext | null} */ let ctx = null;

  /** Resolved in start(), never at import. A module that reads the document to
   *  be imported cannot share a page with anything. */
  /** @type {HTMLElement} */ let statusEl;
  /** @type {HTMLElement} */ let logEl;

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
   *  @returns {import('../ftdi.js').Ftdi | null} */
  function requireFtdi() {
    if (!ctx?.ftdi) {
      setStatus('connect the device first');
      return null;
    }
    return ctx?.ftdi;
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

  /** @param {import('../ftdi.js').Ftdi} dev */
  async function logPinState(dev) {
    const value = await dev.readPins();
    const d4 = (value >> 4) & 1, d5 = (value >> 5) & 1;
    const d6 = (value >> 6) & 1, d7 = (value >> 7) & 1;
    log(`read pins: ${bin8(value)}  D4=${d4} D5=${d5} D6=${d6} D7=${d7}`);
    return value;
  }

  /**
   * ②'s verdict: one number, and whether the code that ships already has it.
   *
   * The reading is bytes per baud tick, and it has to survive two independent
   * ways of being wrong. Move the byte count: a rate scales with it, a
   * truncated write does not. Move the baud: a rate that follows the request
   * scales with it, a chip that ignores the request does not move at all. Only
   * when both hold is there a multiplier to report — and it is then compared
   * against what `ftdi.js` is actually using, because a bench that prints a
   * number and leaves the comparison to whoever remembers the constant is a
   * bench that gets believed for a day. (It did, on 2026-09-20.)
   *
   * @param {Array<{ bytes: number, baud: number, wrote: number | null, run: NonNullable<ReturnType<typeof readRun>> }>} byteRounds
   * @param {typeof byteRounds} baudRounds
   */
  function reportByteRate(byteRounds, baudRounds) {
    const all = [...byteRounds, ...baudRounds];
    /** @param {typeof all[0]} r */
    const rate = (r) => r.bytes / r.run.seconds;          // bytes per second
    const perByte = byteRounds.map((r) => 1000 / rate(r)); // ms per byte
    const factors = all.map((r) => rate(r) / r.baud);      // bytes per baud tick

    const out = all.map((r) =>
      `${String(r.bytes).padStart(5)} bytes @ ${String(r.baud).padStart(4)} baud`
      + ` → ${r.run.seconds.toFixed(2)} s  (${Math.round(rate(r))} bytes/s,`
      + ` ${(rate(r) / r.baud).toFixed(2)}× the baud, ±${r.run.pollMs} ms)`
      + (r.wrote !== null && r.wrote < r.bytes + 1 ? `  ⚠️ only ${r.wrote} written` : ''));

    const short = all.filter((r) => r.wrote !== null && r.wrote < r.bytes + 1);
    if (short.length) {
      out.push(`⚠️ the host did not write everything it was handed, in ${short.length} of ${all.length} rounds.`);
      out.push('   The stop byte is the LAST byte, so a truncated stream is also a car that never stops.');
      out.push('   Fix that before believing any rate below.');
      return done(out);
    }
    if (spread(perByte) > 1.25) {
      out.push(`⚠️ the byte counts do not agree: ${spread(perByte).toFixed(2)}× between the fastest and slowest ms/byte.`);
      out.push('   A rate is a rate — doubling the bytes doubles the run. Something other than the byte');
      out.push('   count is setting the length of these runs, so there is no rate to report.');
      return done(out);
    }
    if (baudRounds.length && spread(baudRounds.map(rate)) < 1.25) {
      out.push('⚠️ the byte rate did not move when the baud did — the request is not being honoured.');
      out.push('   Every duration the product asks for is computed from a baud this part is ignoring.');
      return done(out);
    }
    if (spread(factors) > 1.25) {
      out.push(`⚠️ the multiplier itself moved, ${spread(factors).toFixed(2)}× across these settings —`);
      out.push('   it is not one constant, and one number cannot describe this part.');
      return done(out);
    }

    const tick = factors.reduce((a, b) => a + b, 0) / factors.length;
    const bytesPerMs = tick * BENCH_BAUD / 1000;
    out.push(`✅ ${tick.toFixed(2)} bytes per baud tick, steady across ${all.length} rounds,`
      + ` ${BYTE_RATE_SWEEP.length} byte counts and ${baudRounds.length + 1} bauds.`);
    out.push(`→ bytesPerMs = ${bytesPerMs.toFixed(2)} at ${BENCH_BAUD} baud (${(1000 / (bytesPerMs * 1000)).toFixed(3)} ms per byte)`);

    // The comparison is the point. A number the reader has to carry to another
    // file to interpret is a number that gets carried wrong.
    const off = bytesPerMs / DEFAULT_BYTES_PER_MS;
    out.push(off > 0.85 && off < 1.15
      ? `✅ ftdi.js is using ${DEFAULT_BYTES_PER_MS.toFixed(2)} — this board agrees with what ships. Nothing to change.`
      : `⚠️ ftdi.js is using ${DEFAULT_BYTES_PER_MS.toFixed(2)}, which is ${off.toFixed(2)}× off for this board.`);
    if (off <= 0.85 || off >= 1.15) {
      out.push(`   Write ${bytesPerMs.toFixed(2)} into config.calibration.bytesPerMs — that is this board's`);
      out.push('   measurement and it overrides the model. Change the default in ftdi.js only if every board does this.');
      out.push(`   Then re-run ⑧: every pulse it has ever tested was ${off < 1 ? (1 / off).toFixed(1) + '× longer' : off.toFixed(1) + '× shorter'} than its label.`);
    }
    return done(out);
  }

  /** @param {number[]} xs */
  const spread = (xs) => Math.max(...xs) / Math.min(...xs);

  /** @param {string[]} out */
  function done(out) {
    el('byteRateResult').textContent = out.join('\n');
    log(out.join('\n'));
  }

  /**
   * The stopwatch path: one length, timed by hand. Kept for a part whose
   * read-back does not work — ±200 ms still separates 1:1 from ÷8, which was
   * ②'s original question.
   *
   * @param {number} seconds
   */
  function reportStopwatch(seconds) {
    const theory = BYTE_RATE_TEST_BYTES / BENCH_BAUD;
    const msPerByte = (seconds * 1000) / BYTE_RATE_TEST_BYTES;
    const out = [
      `${seconds.toFixed(2)} s by hand / theory ${theory.toFixed(1)} s = ratio ${(seconds / theory).toFixed(3)}`,
      `${msPerByte.toFixed(3)} ms per byte  →  bytesPerMs = ${(1 / msPerByte).toFixed(2)}`,
      Math.abs(seconds / theory - 1) < 0.25
        ? '✅ ratio ≈ 1: one byte per baud tick, which is what bytesPerMs assumes'
        : '⚠️ ratio is not ≈ 1 — the multiplier is not 1:1 on this part, so DEFAULT_BYTES_PER_MS in ftdi.js is wrong for it',
      'ⓘ a stopwatch on a run this short also times your own reaction, and the motor keeps turning after the pins drop. Prefer the button above.',
    ];
    el('byteRateResult').textContent = out.join('\n');
    log(out.join('\n'));
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

  return {
    name: NAME,

    /** @param {import('./context.js').DevContext} c */
    start(c) {
      ctx = c;
      statusEl = el('status');
      logEl = el('log');
      ctx.status('usb', 'dim', 'USB not connected');


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

            // Mind the timing. 3000 bytes at 1200 baud run for about 2.5 s, but
            // this writes only 600 ms — 720 bytes, gone in 600 ms —
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

      /**
       * One round: write `bytes` forward bytes at whatever baud is set, and
       * report what the pins did. Shared by both sweeps — the two differ only
       * in which axis they move.
       *
       * @param {import('../ftdi.js').Ftdi} dev
       * @param {number} bytes
       * @param {number} baud what the chip was last asked for, for the log
       * @returns {Promise<{ bytes: number, baud: number, wrote: number | null,
       *   run: NonNullable<ReturnType<typeof readRun>> } | null>}
       */
      async function oneRound(dev, bytes, baud) {
        // Spec §12 ② asks for an exact buffer here, not the byte count
        // buildStream() would estimate from bytesPerMs — bytesPerMs is the thing
        // being measured, and feeding the estimate back in would make the experiment
        // measure its own assumption.
        const stream = new Uint8Array(bytes + 1);
        stream.fill(0x10, 0, bytes);
        stream[bytes] = 0x00;

        log(`--- ${bytes} bytes @ ${baud} baud, one byte per tick would be ${(bytes / baud).toFixed(2)} s ---`);
        const { reads, wrote } = await traceTheRun(dev, stream);
        const run = readRun(reads);
        // The trace goes to the log every time, not only when something looks
        // wrong: it is the evidence behind the number, and a reading whose
        // evidence is thrown away is a reading nobody can go back to.
        log(`pins: ${pinTrace(reads)}`);
        log(`the host says it wrote ${wrote ?? '?'} of ${bytes + 1} bytes`);
        if (!run) {
          log('!! the pins never read high — nothing was timed.');
          log('   Either the chip is not driving them, or this part refuses the read-back.');
          setStatus('the pins never read high — nothing to time');
          return null;
        }
        log(`${run.seconds.toFixed(2)} s (${run.reads} reads, ${run.pollMs} ms apart)`);
        if (run.dips) {
          log(`⚠️ the pins read low ${run.dips} time(s) mid-run, the first at ${run.toFirstDip.toFixed(2)} s —`);
          log('   the reading spans the first high read to the last, so a glitch cannot shorten it,');
          log('   but if the car stopped and restarted, the trace above is what says so.');
        }
        // Long enough that the pins are unambiguously down before the next round
        // starts, short enough that it is not a pause you would call a pause.
        await new Promise((r) => setTimeout(r, 400));
        return { bytes, baud, wrote, run };
      }

      el('byteRateBtn').addEventListener('click', async () => {
        const dev = requireFtdi();
        if (!dev) return;

        setDisabled('byteRateBtn', true);
        try {
          // Two passes, not two buttons. Neither one is a measurement on its
          // own: a truncated write scales with the byte count exactly as a rate
          // does, and a chip that ignores the baud request and free-runs at one
          // fixed clock passes the byte sweep without noticing it was asked
          // anything. Offering them separately would have written "either of
          // these will do" over a procedure where neither will.
          log('=== pass 1 of 2: does the run scale with the BYTES? ===');
          await dev.setBaudRate(BENCH_BAUD);
          /** @type {Array<{ bytes: number, baud: number, wrote: number | null,
           *   run: NonNullable<ReturnType<typeof readRun>> }>} */
          const rounds = [];
          for (const bytes of BYTE_RATE_SWEEP) {
            const round = await oneRound(dev, bytes, BENCH_BAUD);
            if (!round) return;
            rounds.push(round);
          }

          log('=== pass 2 of 2: does it follow the BAUD? ===');
          /** @type {typeof rounds} */ const baudRounds = [];
          for (const baud of BAUD_SWEEP) {
            if (baud === BENCH_BAUD) continue; // pass 1 already has this one
            // What came back, not what was asked: below ~732 the divisor field
            // saturates and the request is clamped, and comparing a clamped run
            // against the request is how a constant multiplier reads as one
            // that moved.
            const actual = await dev.setBaudRate(baud);
            if (actual !== baud) {
              log(`asked for ${baud} baud, the divisor can only express ${actual} — this round is about ${actual}`);
            }
            const round = await oneRound(dev, BYTE_RATE_TEST_BYTES, actual);
            if (!round) return;
            baudRounds.push(round);
          }
          reportByteRate(rounds, baudRounds);
        } catch (err) {
          const e = /** @type {Error} */ (err);
          log(`!! ${e.name}: ${e.message}`);
          setStatus(`write failed: ${e.message}`);
        } finally {
          try { await dev.setBaudRate(BENCH_BAUD); } catch { /* the log already has the real failure */ }
          setDisabled('byteRateBtn', false);
        }
      });

      // The stopwatch, for a part whose read-back does not work. ±200 ms on a
      // 2.5 s run is coarse, and still settles 1:1 against ÷8 — which is the
      // only question ② asks.
      el('computeBtn').addEventListener('click', () => {
        const seconds = Number(inputEl('measuredSeconds').value);
        if (!seconds) return;
        reportStopwatch(seconds);
      });

      // --- ⑧ the motor's starting threshold ----------------------------------------
      //
      // Seventy presses, and until now nothing counted them: the procedure asked
      // for ten tries at each of seven lengths and left the score in somebody's
      // head, to be written into docs/hardware.md from memory at the end. It also
      // could not be run at all before ② was fixed — every pulse it fired was a
      // fifth of its label.

      /** @type {Map<number, { tries: number, hits: number }>} */
      const trials = new Map();
      /** The length last fired and still waiting for a verdict. */
      /** @type {number | null} */ let pending = null;

      /** @param {boolean} armed */
      function armVerdict(armed) {
        // Exactly one of the two is available at any moment. A ladder that stays
        // live during a pending verdict invites a second pulse that no ✓ or ✗
        // will ever be attached to, and the tally silently stops meaning ten.
        for (const b of document.querySelectorAll('[data-pulse]')) {
          /** @type {HTMLButtonElement} */ (b).disabled = armed;
        }
        setDisabled('pulseMoved', !armed);
        setDisabled('pulseStill', !armed);
      }

      function renderTrials() {
        const { rows, threshold, unfinished } = summariseTrials(trials);
        if (!rows.length) { setStat('pulseResult', 'No trials yet.'); return; }
        const out = rows.map((r) =>
          `${String(r.ms).padStart(4)} ms  ${'✓'.repeat(r.hits)}${'✗'.repeat(r.tries - r.hits)}`
          + `  ${r.hits}/${r.tries}${r.passed ? '  ← every time' : ''}`);
        if (threshold === null) {
          out.push(`no length has moved the car ${TRIES_PER_PULSE} times out of ${TRIES_PER_PULSE} yet.`);
        } else {
          out.push(`⑧ = ${threshold} ms — the shortest pulse that moved it ${TRIES_PER_PULSE}/${TRIES_PER_PULSE}.`);
          if (unfinished.length) {
            out.push(`⚠️ but ${unfinished.map((r) => r.ms).join(', ')} ms ${unfinished.length > 1 ? 'have' : 'has'} not had ${TRIES_PER_PULSE} tries.`);
            out.push('   Untested is not the same as ruled out — the answer can still come down.');
          }
          out.push(threshold > MIN_DURATION_MS
            ? `⚠️ executor.js uses MIN_DURATION_MS = ${MIN_DURATION_MS}, which this board does not obey. Raise it to ${threshold}:`
              + ' below it the LLM can ask for a move that the pins really make and the car ignores, with nothing anywhere reporting a fault.'
            : `✅ executor.js uses MIN_DURATION_MS = ${MIN_DURATION_MS}, which is at or above this. Nothing to change.`);
        }
        setStat('pulseResult', out.join('\n'));
      }

      for (const button of document.querySelectorAll('[data-pulse]')) {
        const btn = /** @type {HTMLElement} */ (button);
        btn.addEventListener('click', async () => {
          const dev = requireFtdi();
          if (!dev) return;

          const ms = Number(btn.dataset.pulse);
          try {
            await dev.write(dev.buildStream(0x10, ms));
            pending = ms;
            armVerdict(true);
            log(`⑧ ${ms} ms — did the car move? ✓ or ✗ below.`);
          } catch (err) {
            const e = /** @type {Error} */ (err);
            log(`!! ${e.name}: ${e.message}`);
            setStatus(`write failed: ${e.message}`);
          }
        });
      }

      for (const [id, moved] of /** @type {Array<[string, boolean]>} */ (
        [['pulseMoved', true], ['pulseStill', false]])) {
        el(id).addEventListener('click', () => {
          if (pending === null) return;
          const row = trials.get(pending) ?? { tries: 0, hits: 0 };
          row.tries += 1;
          if (moved) row.hits += 1;
          trials.set(pending, row);
          log(`⑧ ${pending} ms: ${moved ? '✓ moved' : '✗ nothing'} (${row.hits}/${row.tries})`);
          pending = null;
          armVerdict(false);
          renderTrials();
        });
      }

      el('pulseReset').addEventListener('click', () => {
        trials.clear();
        pending = null;
        armVerdict(false);
        renderTrials();
        log('⑧ tally cleared');
      });

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


      reportEnvironment();
    },

    /** Nothing to tear down: no stream, no timer. The car is stopped by the one
     *  emergency stop, which dev.js owns. */
    stop() { ctx = null; },
  };
}

// Teaching it which way is which (calibration ① and ①b), as a sheet of its own.
//
// It used to live inside the settings sheet, because that was the only sheet
// there was. It has two doors now — the robot's wheels, and a row in settings
// — and a flow with two doors that renders inside one of them is a flow that
// drags a whole settings panel onto the screen behind it.
//
// This asks dev.html's question differently on purpose. The bench asks
// whether the chip is driving the pins at all — read-back, MISMATCH,
// AMBIGUOUS — and its reader is holding a soldering iron. This asks somebody
// who just wants the car to go the right way what they saw: which way did it
// go. Twice, because there are two drivers and each is wired the way it is
// wired — and forward has to be settled first, or the turn is being watched on
// a car that may be reversing.

import { t } from './strings.js';
import { aheadDrive } from './executor.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** How long the turn lasts. Long enough to see, short enough that a car
 *  pointed at a wall does not reach it. */
const TURN_MS = 600;

/** The straight run of the first question. Shorter than the turn on purpose:
 *  a car going straight covers far more floor than one swinging its axle, and
 *  this one is deliberately aimed at nothing. Still above MIN_DURATION_MS, or
 *  the motor may never break static friction and the answer would be "it did
 *  not move", which this sheet has no button for. */
const DRIVE_MS = 400;

/**
 * @param {{
 *   lang: 'en' | 'zh',
 *   openCar: (opts?: { raw?: boolean }) =>
 *     Promise<{ executor: import('./executor.js').Executor }>,
 *   onCalibrated: (patch: Partial<import('./config.js').Calibration>) => void,
 *   onChange: () => void,
 *   log: (msg: string) => void,
 * }} deps
 */
export function createCalibration(deps) {
  const sheet = $('calSheet');
  const cal = $('cal');
  const foot = $('calFoot');

  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  /** Where closing goes when this was opened from a sheet rather than from the
   *  robot — see the same field in setup-sheet.js.
   *  @type {(() => void) | null} */
  let back = null;

  /**
   * What the first question answered, held for the second one.
   *
   * The second test has to be driven the way this car actually goes forward,
   * and it runs on a `raw` executor — one built with no calibration, so that
   * ① is measured rather than confirmed. So the correction cannot come from
   * the executor and has to be applied here, by naming the other bit.
   */
  let driveSwapped = false;

  /** @param {{ back?: () => void }} [opts] */
  function open(opts = {}) {
    back = opts.back ?? null;
    // Both offered, because they are different intentions: one returns to the
    // drawer this was opened from, the other is done. They sit outside the
    // flow rather than inside it, so leaving is possible at every step and not
    // only at the end — this can be opened by mistake, and a car that has been
    // told to turn is not a good place to be stuck.
    foot.textContent = '';
    if (back) foot.append(footButton('back', () => close()));
    foot.append(footButton('close', () => { back = null; close(); }));
    sheet.hidden = false;
    // ①b first, always, even on a car that has been through this before: ① is
    // measured by watching a car that is driving forward, and "forward" is
    // what the question before it establishes.
    driveSwapped = false;
    ask('calDriveIntro', [['calGo', () => void drive()]]);
  }

  /**
   * @param {import('./strings.js').StringKey} key
   * @param {() => void} fn
   */
  function footButton(key, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'quiet';
    b.textContent = t(deps.lang, key);
    b.addEventListener('click', fn);
    return b;
  }

  function close() {
    sheet.hidden = true;
    deps.onChange();
    const to = back;
    back = null;
    to?.();
  }

  /**
   * One straight run, and the first of the two questions.
   *
   * The car is told to go FORWARD with the axle centred. If it reversed, the
   * motor's two leads are the other way round — that is the whole of item ①b,
   * and like ① it is stored as a boolean rather than as a byte.
   *
   * Centred on purpose: a run with a side bit raised would be asking about two
   * unknowns at once, and neither answer would mean anything on its own.
   */
  async function drive() {
    ask('calDriveIntro', []);
    if (!(await run('forward', 'straight', DRIVE_MS, drive))) return;
    ask('calDriveAsk', [
      ['calForward', () => settleDrive(false)],
      ['calBack', () => settleDrive(true)],
      ['calAgain', () => void drive()],
    ]);
  }

  /** @param {boolean} swapped */
  function settleDrive(swapped) {
    driveSwapped = swapped;
    deps.onCalibrated({ driveSwapped: swapped });
    ask('calIntro', [['calGo', () => void turn()]]);
  }

  /**
   * One turn, and the second question.
   *
   * The car is told to go LEFT. If it went right, the steering is reversed —
   * item ①. It is driven by whichever bit the question before it found to be
   * forward, because "which way did it turn" is only a question about a car
   * that is going forwards.
   */
  async function turn() {
    ask('calIntro', []);
    if (!(await run(aheadDrive({ driveSwapped }), 'left', TURN_MS, turn))) return;
    ask('calAsk', [
      ['calLeft', () => settleSteer(false)],
      ['calRight', () => settleSteer(true)],
      ['calAgain', () => void turn()],
    ]);
  }

  /** @param {boolean} swapped */
  function settleSteer(swapped) {
    deps.onCalibrated({ steerSwapped: swapped });
    // No button of its own: leaving is what the two in the footer are for, and
    // a third one saying the same thing is a third thing to read.
    ask('calDone', []);
  }

  /**
   * Move the car once, the same way for both questions.
   *
   * `raw`: an executor built with no calibration, so pinsFor gives the
   * wiring's own mapping. Measuring through the setting being measured would
   * be asking the car to confirm what it had already been told. Everything
   * else about the executor — the coast limit, stopping on a disconnect — is
   * wanted here exactly as much as anywhere else.
   *
   * @param {string} drive_ @param {string} steer @param {number} ms
   * @param {() => void} again what the retry button re-runs
   * @returns {Promise<boolean>} false if the car never moved and this has
   *   already put the failure on screen
   */
  async function run(drive_, steer, ms, again) {
    try {
      const { executor } = await deps.openCar({ raw: true });
      await executor.move([{ drive: drive_, steer, duration_ms: ms }]);
      return true;
    } catch (err) {
      deps.log('calibration: ' + /** @type {Error} */ (err).message);
      ask('calNoCar', [['calAgain', () => void again()]]);
      return false;
    }
  }

  /**
   * @param {import('./strings.js').StringKey} key
   * @param {[import('./strings.js').StringKey, () => void][]} buttons
   */
  function ask(key, buttons) {
    cal.textContent = '';
    const p = document.createElement('p');
    p.className = 'cal-say';
    p.textContent = t(deps.lang, key);
    const row = document.createElement('div');
    row.className = 'cal-row';
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.className = 'quiet';
      b.textContent = t(deps.lang, label);
      b.addEventListener('click', fn);
      row.append(b);
    }
    cal.append(p, row);
  }

  return { open, close };
}

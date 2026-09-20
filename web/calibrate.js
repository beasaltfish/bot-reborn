// Teaching it left from right (calibration ①), as a sheet of its own.
//
// It used to live inside the settings sheet, because that was the only sheet
// there was. It has two doors now — the robot's wheels, and a row in settings
// — and a flow with two doors that renders inside one of them is a flow that
// drags a whole settings panel onto the screen behind it.
//
// This asks bench.html's question differently on purpose. The bench asks
// whether the chip is driving the pins at all — read-back, MISMATCH,
// AMBIGUOUS — and its reader is holding a soldering iron. This asks one
// question of somebody who just wants the car to turn the right way: which way
// did it go.

import { t } from './strings.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** How long the turn lasts. Long enough to see, short enough that a car
 *  pointed at a wall does not reach it. */
const TURN_MS = 600;

/**
 * @param {{
 *   lang: 'en' | 'zh',
 *   openCar: (opts?: { raw?: boolean }) =>
 *     Promise<{ executor: import('./executor.js').Executor }>,
 *   onCalibrated: (swapped: boolean) => void,
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
    ask('calIntro', [['calGo', () => void turn()]]);
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
   * One turn, then the only question this sheet asks.
   *
   * The car is told to go LEFT. If it went right, the wiring is reversed —
   * that is the whole of item ①, and it is why the answer is stored as a
   * boolean rather than as a byte.
   */
  async function turn() {
    ask('calIntro', []);
    try {
      // `raw`: an executor built with no calibration, so pinsFor gives the
      // wiring's own mapping. Measuring through the setting being measured
      // would be asking the car to confirm what it had already been told.
      // Everything else about the executor — the coast limit, stopping on a
      // disconnect — is wanted here exactly as much as anywhere else.
      const { executor } = await deps.openCar({ raw: true });
      await executor.move([{ drive: 'forward', steer: 'left', duration_ms: TURN_MS }]);
    } catch (err) {
      deps.log('calibration: ' + /** @type {Error} */ (err).message);
      return ask('calNoCar', [['calAgain', () => void turn()]]);
    }
    ask('calAsk', [
      ['calLeft', () => settle(false)],
      ['calRight', () => settle(true)],
      ['calAgain', () => void turn()],
    ]);
  }

  /** @param {boolean} swapped */
  function settle(swapped) {
    deps.onCalibrated(swapped);
    // No button of its own: leaving is what the two in the footer are for, and
    // a third one saying the same thing is a third thing to read.
    ask('calDone', []);
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

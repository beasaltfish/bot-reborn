// The sheet behind the gear: what is still missing, and the one step that can
// be done from here.
//
// It renders steps.js — the same answer the button on the main screen renders,
// so the list and the button cannot disagree about what is next (spec §6).
//
// Calibration lives here rather than on bench.html because the two ask
// different questions of the same wires. The bench asks whether the chip is
// driving the pins at all — read-back, MISMATCH, AMBIGUOUS — and its reader is
// holding a soldering iron. This asks one question, of somebody who just wants
// the car to turn the right way: which way did it go.

import { t } from './strings.js';
import { checklist } from './steps.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** How long the calibration turn lasts. Long enough to see, short enough that
 *  a car pointed at a wall does not reach it. */
const TURN_MS = 600;

/** @type {Record<import('./steps.js').Step, import('./strings.js').StringKey>} */
const LABEL = { keys: 'stepKeys', car: 'stepCar', steer: 'stepSteer' };
const MARK = { done: '✓', current: '▸', todo: '' };

/**
 * Steps that are finished somewhere else, and where.
 *
 * The page they lead to writes the same config this list reads, so coming back
 * ticks the row. Until a step has either a flow here or a destination here, the
 * button on the main screen hands the user a list whose current row does
 * nothing — which is the same dead end as an inert gear, one screen deeper.
 */
const AWAY = { keys: 'setup.html' };

/**
 * @param {{
 *   lang: 'en' | 'zh',
 *   done: () => import('./steps.js').Done,
 *   openCar: (opts?: { raw?: boolean }) =>
 *     Promise<{ executor: import('./executor.js').Executor }>,
 *   onCalibrated: (swapped: boolean) => void,
 *   onChange: () => void,
 *   log: (msg: string) => void,
 * }} deps
 */
export function createSettings(deps) {
  const sheet = $('sheet');
  const rows = $('sheetSteps');
  const cal = $('cal');

  $('sheetClose').textContent = t(deps.lang, 'close');
  $('sheetClose').addEventListener('click', () => close());
  $('settings').addEventListener('click', (e) => { e.preventDefault(); open(); });
  // The backdrop is the sheet itself; a click that lands on it rather than on
  // the panel inside is a click outside.
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  function open() { render(); sheet.hidden = false; }
  function close() { sheet.hidden = true; cal.hidden = true; deps.onChange(); }

  function render() {
    rows.textContent = '';
    for (const row of checklist(deps.done())) {
      const li = document.createElement('li');
      li.className = `step step-${row.state}`;
      const mark = document.createElement('span');
      mark.className = 'step-mark';
      mark.textContent = MARK[row.state];
      const text = document.createElement('span');
      text.textContent = t(deps.lang, LABEL[row.step]);
      li.append(mark, text);
      // A row is pressable when there is something to press it towards:
      // calibration runs here, keys are entered on setup.html, and pairing
      // needs a user gesture the fab already owns. A row that looks pressable
      // but is not is the same lie as a gear that opens nothing.
      if (row.step === 'steer') {
        li.classList.add('step-doable');
        li.addEventListener('click', () => startCalibration());
      } else if (row.step in AWAY) {
        li.classList.add('step-doable');
        li.addEventListener('click', () => {
          location.href = AWAY[/** @type {'keys'} */ (row.step)];
        });
      }
      rows.append(li);
    }
  }

  // --- the calibration flow ------------------------------------------------

  function startCalibration() {
    cal.hidden = false;
    ask('calIntro', [['calGo', () => void turn()]]);
  }

  /**
   * One turn, then the only question this page asks.
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
    render();
    ask('calDone', [['close', () => { cal.hidden = true; }]]);
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

  return { open, close, render };
}

// The two cross-cutting knobs, and the rule that only one panel runs at a time.
//
// These are not a panel. Spec §3.1 of the bench design: ⑬ ⑭ ⑮ are each
// "keep-alive × some reading" and ⑦ is "KWS × motor noise", so the crossings
// have to stay available whichever panel is running. Splitting them into
// panels is what killed the old spike/audio page, which had to write on itself
// "this page only plays the sound; it does not do the keeping-alive".

import { createKeepAlive } from '../audio/keepalive.js';

/** @typedef {'off' | 'hidden' | 'always'} KeepAliveMode */

/**
 * `off` returns null — no tone is created at all. It is NOT {always:false},
 * which is the shipped behaviour and one of the two arms ⑫ compares.
 *
 * @param {KeepAliveMode} mode
 * @returns {{ always: boolean } | null}
 */
export function keepAliveOptions(mode) {
  if (mode === 'hidden') return { always: false };
  if (mode === 'always') return { always: true };
  return null;
}

/**
 * One panel at a time. Every panel shares one microphone, one wasm module and
 * one pair of ears, and two panels measuring at once would each be measuring
 * the other.
 *
 * `onChange` fires only on a real transition — never on a refused claim, a
 * stale release, or the holder re-claiming. The panel picker locks on it and
 * the bottom bar mirrors the owner's readings; both would flicker, or blank a
 * running measurement, on events that changed nothing.
 *
 * @param {(owner: string | null) => void} [onChange]
 */
export function createExclusion(onChange = () => {}) {
  /** @type {string | null} */ let owner = null;
  return {
    /** @param {string} name @returns {boolean} whether it may run */
    claim(name) {
      if (owner !== null && owner !== name) return false;
      const changed = owner !== name;
      owner = name;
      if (changed) onChange(owner);
      return true;
    },
    /** A panel may only release what it holds: a late cleanup must not hand
     *  the microphone away from whoever started in the meantime.
     *  @param {string} name */
    release(name) {
      if (owner !== name) return;
      owner = null;
      onChange(null);
    },
    get owner() { return owner; },
  };
}

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * `onStatus` has the same shape as the strip's own `set`, and for the same
 * reason `onOwner` and `onRunning` exist: this module owns the keep-alive and
 * the motor, but it must not reach for the page's strip, its cable or its stop
 * button. The entry file owns all three, and hands the cable back through
 * `executor` — read on each click, because the page may connect and disconnect
 * under it.
 *
 * @param {{
 *   log: (msg: string) => void,
 *   executor?: () => import('../executor.js').Executor | null,
 *   onRunning?: (on: boolean) => void,
 *   onOwner?: (owner: string | null) => void,
 *   onStatus?: (id: string, state: 'go' | 'wait' | 'dim', label: string) => void,
 * }} opts
 */
export function createKnobs(opts) {
  const { log } = opts;
  const status = opts.onStatus ?? (() => {});
  const exclusion = createExclusion(opts.onOwner);

  // --- keep-alive ---------------------------------------------------------
  /** @type {{ stop(): void } | null} */ let keepAlive = null;

  $('kaMode').addEventListener('change', () => {
    keepAlive?.stop();
    keepAlive = null;
    const mode = /** @type {KeepAliveMode} */
      (/** @type {HTMLSelectElement} */ ($('kaMode')).value);
    const kaOpts = keepAliveOptions(mode);
    if (!kaOpts) {
      log('keep-alive: off');
      status('keepalive', 'dim', 'keep-alive off');
      return;
    }
    const ka = createKeepAlive({ ...kaOpts, onLog: log });
    keepAlive = ka;
    // NOT awaited: autoplay needs the gesture this handler is running inside,
    // and a single await spends it. armFromGesture() plays once synchronously
    // to bank the permission; the rejection handler is all we need back.
    ka.armFromGesture().catch((err) => log('keep-alive: ' + err.message));
    log(`keep-alive: ${mode}`);
    status('keepalive', 'go', `keep-alive ${mode}`);
  });

  // --- motor noise (⑦) ----------------------------------------------------
  //
  // The cable belongs to the page, not to this module. This used to open its
  // own — harmless while this file was the audio page's alone, a second
  // claimInterface(0) on the same device the moment the three pages became one,
  // because the entry file wires the same button to the one connect() it owns.
  const executor = opts.executor ?? (() => null);
  const onRunning = opts.onRunning ?? (() => {});
  let circling = false;

  /**
   * Also the page's one stop button: cruise() renews itself and never resolves,
   * and the toggle that started it is somewhere up the page, so the thing that
   * stops the car has to be the one that is always in reach.
   */
  function stopMotor() {
    // A no-op unless this module is the one that set the car going: the page's
    // stop button calls it on every press, and it already stopped the cable
    // itself before asking.
    if (!circling) return;
    executor()?.stop();
    circling = false;
    $('motorToggle').textContent = 'Make the car circle (noise for ⑦)';
    status('motor', 'dim', 'motor off');
    onRunning(false);
  }

  $('motorToggle').addEventListener('click', () => {
    const exec = executor();
    if (!exec) { log('connect the FT232H first'); return; }
    if (circling) {
      stopMotor();
      log('■ motor stopped');
      return;
    }
    // Circling rather than driving straight: ⑦ wants the motor and the gearbox
    // making their noise for a minute at a time, next to the phone, without the
    // car leaving the table. cruise() renews itself and never resolves, so it
    // is deliberately not awaited.
    exec.cruise('forward', 'left');
    circling = true;
    $('motorToggle').textContent = '■ Stop the car';
    status('motor', 'go', 'motor running');
    onRunning(true);
    log('▶︎ motor circling — this is the noise floor ⑦ is measured against');
  });

  return { exclusion, stopMotor };
}

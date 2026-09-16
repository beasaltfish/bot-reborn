// The two cross-cutting knobs, and the rule that only one panel runs at a time.
//
// These are not a panel. Spec §3.1 of the bench design: ⑬ ⑭ ⑮ are each
// "keep-alive × some reading" and ⑦ is "KWS × motor noise", so the crossings
// have to stay available whichever panel is running. Splitting them into
// panels is what killed the old spike/audio page, which had to write on itself
// "this page only plays the sound; it does not do the keeping-alive".

import { createKeepAlive } from '../audio/keepalive.js';
import { Ftdi } from '../ftdi.js';
import { Executor } from '../executor.js';
import { setStat, setDisabled } from './readout.js';

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
 */
export function createExclusion() {
  /** @type {string | null} */ let owner = null;
  return {
    /** @param {string} name @returns {boolean} whether it may run */
    claim(name) {
      if (owner !== null && owner !== name) return false;
      owner = name;
      return true;
    },
    /** A panel may only release what it holds: a late cleanup must not hand
     *  the microphone away from whoever started in the meantime.
     *  @param {string} name */
    release(name) { if (owner === name) owner = null; },
    get owner() { return owner; },
  };
}

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {{ log: (msg: string) => void }} opts */
export function createKnobs(opts) {
  const { log } = opts;
  const exclusion = createExclusion();

  // --- keep-alive ---------------------------------------------------------
  /** @type {{ stop(): void } | null} */ let keepAlive = null;

  $('kaMode').addEventListener('change', () => {
    keepAlive?.stop();
    keepAlive = null;
    const mode = /** @type {KeepAliveMode} */
      (/** @type {HTMLSelectElement} */ ($('kaMode')).value);
    const kaOpts = keepAliveOptions(mode);
    if (!kaOpts) { log('keep-alive: off'); return; }
    const ka = createKeepAlive({ ...kaOpts, onLog: log });
    keepAlive = ka;
    // NOT awaited: autoplay needs the gesture this handler is running inside,
    // and a single await spends it. armFromGesture() plays once synchronously
    // to bank the permission; the rejection handler is all we need back.
    ka.armFromGesture().catch((err) => log('keep-alive: ' + err.message));
    log(`keep-alive: ${mode}`);
  });

  // --- motor noise (⑦) ----------------------------------------------------
  /** @type {Executor | null} */ let executor = null;
  let circling = false;

  $('usbConnect').addEventListener('click', async () => {
    if (!navigator.usb) {
      setStat('usbStatus', 'USB: this browser has no WebUSB (needs Chrome / Edge)');
      return;
    }
    try {
      const ftdi = await Ftdi.open(navigator.usb);
      // Executor's constructor wires ftdi.onDisconnect itself (§4.6) — setting
      // it here as well would just overwrite Executor's own handler.
      executor = new Executor(ftdi, {
        onError: (err) => {
          setStat('usbStatus', `USB: !! ${err.message}`);
          log('executor: ' + err.message);
        },
      });
      setStat('usbStatus', 'USB: connected');
      setDisabled('motorToggle', false);
      log('USB connected');
    } catch (err) {
      setStat('usbStatus', 'USB: ' + /** @type {Error} */ (err).message);
    }
  });

  $('motorToggle').addEventListener('click', () => {
    if (!executor) return;
    if (circling) {
      executor.stop();
      circling = false;
      $('motorToggle').textContent = 'Make the car circle (noise for ⑦)';
      log('■ motor stopped');
      return;
    }
    // Circling rather than driving straight: ⑦ wants the motor and the gearbox
    // making their noise for a minute at a time, next to the phone, without the
    // car leaving the table. cruise() renews itself and never resolves, so it
    // is deliberately not awaited.
    executor.cruise('forward', 'left');
    circling = true;
    $('motorToggle').textContent = '■ Stop the car';
    log('▶︎ motor circling — this is the noise floor ⑦ is measured against');
  });

  return {
    exclusion,
    get executor() { return executor; },
  };
}

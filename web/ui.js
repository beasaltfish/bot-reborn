// Wiring only. Every method here is one or two lines that call into something
// else (spec §10); the one table that used to live here — state to string key —
// moved into robot.js, where it is tested.

import { t } from './strings.js';
import { applyFace } from './robot.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {'en' | 'zh'} lang */
export function createUi(lang) {
  /** @type {string[]} */ const lines = [];
  const robot = $('robot');
  const fab = /** @type {HTMLButtonElement} */ ($('fab'));
  const sleep = /** @type {HTMLButtonElement} */ ($('sleep'));

  sleep.textContent = t(lang, 'sleepBtn');
  $('settings').setAttribute('aria-label', t(lang, 'settings'));

  /**
   * One button, one place, and its face is whatever is most urgent right now.
   * Stage 1 uses two of the tones; §5's earlier rungs arrive in stage 2.
   *
   * A local function rather than a method called through `this`: running()
   * needs it, and a method would break the moment somebody destructured the
   * returned object.
   *
   * @param {'go' | 'stop' | 'wait'} tone
   * @param {import('./strings.js').StringKey} key
   */
  const fabFace = (tone, key) => {
    fab.dataset.tone = tone;
    fab.textContent = t(lang, key);
    fab.setAttribute('aria-label', t(lang, tone === 'stop' ? 'emergencyStop' : key));
    fab.disabled = false;
  };

  /** @param {boolean} on */
  const running = (on) => {
    sleep.disabled = !on;
    fabFace(on ? 'stop' : 'go', on ? 'fabStop' : 'fabStart');
  };

  // Paint the resting face now, not on the caller's first running(false).
  // The fab ships from index.html with no text and disabled, and it is the
  // only way into the app — so "somebody remembers to call this" is not a
  // property this screen can depend on. It shipped grey and wordless once.
  running(false);

  return {
    /** @param {string} msg */
    log(msg) {
      lines.push(`${new Date().toLocaleTimeString()} ${msg}`);
      const el = $('log');
      el.textContent = lines.slice(-200).join('\n');
      el.scrollTop = el.scrollHeight;
    },

    /**
     * The face IS the state display. The live region carries the same thing as
     * text, because an SVG gives a screen reader nothing.
     * @param {import('./audio/session.js').State} s
     */
    setState(s) {
      $('robotLabel').textContent = t(lang, applyFace(robot, s).labelKey);
    },

    /** @param {string} text empty hides the bubble rather than leaving it blank */
    setTranscript(text) {
      const el = $('bubble');
      el.textContent = text;
      el.hidden = !text;
    },

    /** @param {string} text empty hides it */
    notice(text) { $('notice').hidden = !text; $('notice').textContent = text; },

    fabFace,
    running,

    /**
     * The click carries the tone that was painted on the button when it was
     * pressed, so the caller routes on what the user actually saw.
     *
     * The plan had app.js keep its own `running` flag for this. Reading it back
     * off the element is strictly tighter: a separate flag can disagree with
     * the face — and the moment it does, a button reading STOP starts the car.
     *
     * @param {(tone: string) => void} fn
     */
    onFab(fn) { fab.addEventListener('click', () => fn(fab.dataset.tone ?? '')); },

    /** @param {() => void} fn */
    onSleep(fn) { sleep.addEventListener('click', fn); },
  };
}

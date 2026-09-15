// Log, state lamp, the two buttons, and the emergency stop. No logic: every
// handler here is one line that calls into something else (spec §10).

import { t } from './strings.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {Record<import('./audio/session.js').State, import('./strings.js').StringKey>} */
const STATE_KEY = {
  SLEEPING: 'stSleeping',
  LISTENING: 'stListening',
  CAPTURING: 'stCapturing',
  THINKING: 'stThinking',
  SPEAKING: 'stSpeaking',
};

/** @param {'en' | 'zh'} lang */
export function createUi(lang) {
  /** @type {string[]} */ const lines = [];
  const btn = {
    start: /** @type {HTMLButtonElement} */ ($('start')),
    stop: /** @type {HTMLButtonElement} */ ($('stop')),
    estop: /** @type {HTMLButtonElement} */ ($('estop')),
  };

  $('title').textContent = t(lang, 'appTitle');
  btn.start.textContent = t(lang, 'start');
  btn.stop.textContent = t(lang, 'stopBtn');
  btn.estop.textContent = t(lang, 'emergencyStop');

  return {
    /** @param {string} msg */
    log(msg) {
      lines.push(`${new Date().toLocaleTimeString()} ${msg}`);
      const el = $('log');
      el.textContent = lines.slice(-200).join('\n');
      el.scrollTop = el.scrollHeight;
    },
    /** @param {import('./audio/session.js').State} s */
    setState(s) { $('state').textContent = t(lang, STATE_KEY[s]); },
    /** @param {string} text */
    setTranscript(text) { $('transcript').textContent = text; },
    /** @param {string} text empty hides it */
    notice(text) { $('notice').hidden = !text; $('notice').textContent = text; },
    /** @param {boolean} on */
    running(on) {
      btn.start.disabled = on;
      btn.stop.disabled = !on;
      btn.estop.disabled = !on;
    },
    /** @param {() => void} fn */
    onStart(fn) { btn.start.addEventListener('click', fn); },
    /** @param {() => void} fn */
    onStop(fn) { btn.stop.addEventListener('click', fn); },
    /** @param {() => void} fn */
    onEmergencyStop(fn) { btn.estop.addEventListener('click', fn); },
  };
}

// Wiring only. Every method here is one or two lines that call into something
// else (spec §10); the one table that used to live here — state to string key —
// moved into robot.js, where it is tested.

import { t, KEYWORDS } from './strings.js';
import { STEP_LABEL } from './steps.js';
import { applyFace, applyAssembly, hintVisible } from './robot.js';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));

/** @param {'en' | 'zh'} lang */
export function createUi(lang) {
  /** @type {string[]} */ const lines = [];
  const robot = $('robot');
  const fab = /** @type {HTMLButtonElement} */ ($('fab'));
  const mic = /** @type {HTMLButtonElement} */ ($('mic'));

  // The hint depends on two things that arrive through two different calls —
  // running() and setState() — so both are kept and the line is repainted from
  // whichever moved. Deriving it inside only one of them is how it came to
  // hang around all through a conversation: running(true) put it up, and
  // nothing ever took it back down.
  let live = false;
  /** @type {import('./audio/session.js').State} */ let state = 'SLEEPING';
  const paintHint = () => {
    const el = $('hint');
    // Built here rather than stored joined: a STRINGS entry containing the wake
    // word is a line TTS could read aloud, and the robot would answer itself.
    el.textContent = `${t(lang, 'sayThis')} 「${KEYWORDS[0]}」`;
    el.hidden = !hintVisible(live, state);
  };

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
    // Two readings, one element. On: the only control that shuts the ear, and
    // the only place the whole screen says the ear is open at all. Off: a
    // status light — the way in is the one big button, and offering it twice
    // would be offering a choice that is not one.
    mic.dataset.on = String(on);
    mic.setAttribute('aria-label', t(lang, on ? 'micOn' : 'micOff'));
    mic.setAttribute('aria-disabled', String(!on));
    fabFace(on ? 'stop' : 'go', on ? 'fabStop' : 'fabStart');
    // The microphone being open is not a session state — SLEEPING covers both
    // "shut" and "waiting to hear its name" — so it rides on the element
    // instead, and the stylesheet lights the antenna for the second one.
    robot.dataset.live = String(on);
    live = on;
    // A fresh session starts in SLEEPING, and onState only fires on a CHANGE —
    // so the first one may never arrive, and this cannot wait for it.
    if (on) state = 'SLEEPING';
    paintHint();
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
      state = s;
      $('robotLabel').textContent = t(lang, applyFace(robot, s).labelKey);
      paintHint();
    },

    /** @param {string} text empty hides the bubble rather than leaving it blank */
    setTranscript(text) {
      const el = $('bubble');
      el.textContent = text;
      el.hidden = !text;
    },

    /**
     * The one line on this screen that speaks to the user in sentences, so it
     * is also the only place a failure may explain itself. Everything else —
     * boot progress, engine chatter, stack traces — belongs in the console.
     *
     * A failure that names something the user must go and do gets a link,
     * because "open the connectivity test page" is an instruction, and an
     * instruction the screen cannot carry out itself is a dead end.
     *
     * @param {string} text empty hides it
     * @param {{ href: string, label: string }} [go]
     */
    notice(text, go) {
      const el = $('notice');
      el.hidden = !text;
      el.textContent = text;
      if (!text || !go) return;
      const a = document.createElement('a');
      a.href = go.href;
      a.textContent = go.label;
      a.className = 'notice-go';
      el.append(' ', a);
    },

    fabFace,
    running,

    /**
     * Whether the car has never been paired. Not a session state — SLEEPING
     * already means "not doing anything" — so it rides on the element, the
     * same way data-live does.
     * @param {boolean} on
     */
    needCar(on) { robot.dataset.need = on ? 'car' : ''; },
    /** @param {import('./robot.js').Part[]} parts */
    assembly(parts) { applyAssembly(robot, parts); },

    /**
     * Which step the robot is offering to start if it is touched. The same
     * rung the button is showing, so the ring and the button never point at
     * two different steps.
     * @param {import('./steps.js').Step | null} step
     */
    nextPart(step) { robot.dataset.next = step ?? ''; },

    /**
     * The robot is the checklist. A band is pressed, and the step it stands
     * for is what happens — no list in between.
     * @param {(step: import('./steps.js').Step) => void} fn
     */
    onPart(fn) {
      for (const el of document.querySelectorAll('.part')) {
        const step = /** @type {import('./steps.js').Step} */ (
          /** @type {HTMLElement} */ (el).dataset.part);
        el.setAttribute('aria-label', t(lang, STEP_LABEL[step]));
        el.addEventListener('click', () => fn(step));
      }
    },

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

    /**
     * Shutting the microphone. Gated on what is painted on the element rather
     * than on a flag of the caller's — the same reason onFab reads its tone
     * back off the button: a separate flag can disagree with what the user is
     * looking at, and here that would mean a status light that stops the
     * robot when tapped.
     *
     * @param {() => void} fn
     */
    onMic(fn) {
      mic.addEventListener('click', () => { if (mic.dataset.on === 'true') fn(); });
    },
  };
}

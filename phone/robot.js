// The character, and the only place that decides what it looks like.
//
// session.js already owns five states and app.js already routes them here
// (ui.setState). This file translates one into a set of data attributes; the
// SVG in index.html is static and CSS picks the parts. Nothing here builds
// markup, so the shape of the robot can be redrawn without touching JS.
//
// Why a descriptor rather than one class per state: the five faces share
// parts, and "LISTENING plus sound waves" is what CAPTURING actually is. Five
// opaque classes would let that pair drift apart silently — see the test that
// pins them together.

import { directionsTaught } from './config.js';

/** @typedef {import('../core/audio/session.js').State} State */
/** @typedef {import('../core/strings.js').StringKey} StringKey */

/**
 * @typedef {{
 *   eyes: 'closed' | 'open' | 'up' | 'smile',
 *   antenna: 'off' | 'lit' | 'orbit',
 *   waves: boolean,
 *   mouth: boolean,
 *   doze: boolean,
 *   motion: 'breathe' | 'bob' | 'still',
 *   tint: 'dim' | 'go' | 'wait',
 *   labelKey: StringKey,
 * }} Face
 */

/**
 * What the drawing is cropped to. The whole robot while it is being assembled —
 * the body and the wheels are two of the checklist's doors — and the head alone
 * once it listens, because then the phone IS the head, sitting on a real body.
 *
 * The face box is the head plus everything that happens around it: the antenna
 * dot at the top (y 8), the sound waves at either side (x 1…119), the doze
 * letters at the top right. Its 120 × 84 is landscape, which is how the phone
 * rides.
 */
export const VIEWBOX = { whole: '0 0 120 134', face: '0 4 120 84' };

/** session.js's own five, in its own order. */
export const STATES = /** @type {const} */ ([
  'SLEEPING', 'LISTENING', 'CAPTURING', 'THINKING', 'SPEAKING',
]);

/**
 * Every state owns at least one part nobody else uses: the waves are
 * CAPTURING's, the mouth is SPEAKING's, the orbiting antenna is THINKING's.
 * SLEEPING was the one with nothing of its own — it was "the others, minus
 * things" — and it read as an ordinary idle robot. `doze` is its part.
 *
 * @type {Record<State, Face>}
 */
const FACES = {
  SLEEPING:  { eyes: 'closed', antenna: 'off',   waves: false, mouth: false, doze: true,  motion: 'breathe', tint: 'dim',  labelKey: 'stSleeping' },
  LISTENING: { eyes: 'open',   antenna: 'lit',   waves: false, mouth: false, doze: false, motion: 'bob',     tint: 'go',   labelKey: 'stListening' },
  CAPTURING: { eyes: 'open',   antenna: 'lit',   waves: true,  mouth: false, doze: false, motion: 'bob',     tint: 'go',   labelKey: 'stCapturing' },
  THINKING:  { eyes: 'up',     antenna: 'orbit', waves: false, mouth: false, doze: false, motion: 'still',   tint: 'wait', labelKey: 'stThinking' },
  SPEAKING:  { eyes: 'smile',  antenna: 'lit',   waves: false, mouth: true,  doze: false, motion: 'bob',     tint: 'go',   labelKey: 'stSpeaking' },
};

/**
 * The parts the robot has not been given yet. A brain is the ears, the mind
 * and the voice at once: one scan of the admin page's code gives all three,
 * so they are missing or present together.
 *
 * @typedef {'ears' | 'mind' | 'voice' | 'wheels'} Part
 * @param {import('./config.js').BodyConfig} config
 * @returns {Part[]}
 */
export function missingParts(config) {
  /** @type {Part[]} */
  const missing = [];
  if (!config.token) missing.push('ears', 'mind', 'voice');
  if (!directionsTaught(config.calibration)) missing.push('wheels');
  return missing;
}

// Three of the four parts are one step: the brain.
/** @type {Record<Part, import('./steps.js').Step>} */
export const PART_STEP = { ears: 'brain', mind: 'brain', voice: 'brain', wheels: 'steer' };

/**
 * Written as one attribute holding a token list, so the stylesheet asks
 * `[data-missing~="ears"]` and no part needs an attribute of its own.
 *
 * @param {HTMLElement} root
 * @param {Part[]} parts
 */
export function applyAssembly(root, parts) {
  root.dataset.missing = parts.join(' ');
}

/**
 * Whether to show the "say its name" line.
 *
 * Two conditions, and the second one is the one this was missing: the hint is
 * an instruction, and an instruction stops being one the moment it has been
 * carried out. SLEEPING is the only state where saying the name does anything
 * — §5.3 keeps KWS subscribed there and #onWake answers it — so from
 * LISTENING onwards the line is telling the user to do something they have
 * already done, on a robot that is visibly awake and waiting.
 *
 * It comes back when the session times out to SLEEPING (§5.2), which is
 * exactly when it is true again.
 *
 * With the wake word switched off there is no name to say at all: the robot
 * starts awake and has no SLEEPING to be woken from.
 *
 * @param {boolean} live whether the microphone is open at all
 * @param {State} state
 * @param {boolean} wakeWord whether saying its name does anything
 * @returns {boolean}
 */
export function hintVisible(live, state, wakeWord) {
  return wakeWord && live && state === 'SLEEPING';
}

/** @param {State} state @returns {Face} */
export function faceFor(state) {
  const face = FACES[state];
  if (!face) throw new Error(`no face for state: ${state}`);
  return face;
}

/**
 * Throwing on an unknown state is deliberate. The alternative — leaving the
 * last face in place — shows an awake robot for a session that has moved on,
 * and that is the failure nobody would notice.
 *
 * @param {HTMLElement} root
 * @param {State} state
 * @returns {Face}
 */
export function applyFace(root, state) {
  const f = faceFor(state);
  root.dataset.face = state;
  root.dataset.eyes = f.eyes;
  root.dataset.antenna = f.antenna;
  root.dataset.waves = String(f.waves);
  root.dataset.mouth = String(f.mouth);
  root.dataset.doze = String(f.doze);
  root.dataset.motion = f.motion;
  root.dataset.tint = f.tint;
  return f;
}

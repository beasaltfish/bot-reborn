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

import { layerReady } from './config.js';

/** @typedef {import('./audio/session.js').State} State */
/** @typedef {import('./strings.js').StringKey} StringKey */

/**
 * @typedef {{
 *   eyes: 'closed' | 'open' | 'up' | 'smile',
 *   antenna: 'off' | 'lit' | 'orbit',
 *   waves: boolean,
 *   mouth: boolean,
 *   motion: 'breathe' | 'bob' | 'still',
 *   tint: 'dim' | 'go' | 'wait',
 *   labelKey: StringKey,
 * }} Face
 */

/** session.js's own five, in its own order. */
export const STATES = /** @type {const} */ ([
  'SLEEPING', 'LISTENING', 'CAPTURING', 'THINKING', 'SPEAKING',
]);

/** @type {Record<State, Face>} */
const FACES = {
  SLEEPING:  { eyes: 'closed', antenna: 'off',   waves: false, mouth: false, motion: 'breathe', tint: 'dim',  labelKey: 'stSleeping' },
  LISTENING: { eyes: 'open',   antenna: 'lit',   waves: false, mouth: false, motion: 'bob',     tint: 'go',   labelKey: 'stListening' },
  CAPTURING: { eyes: 'open',   antenna: 'lit',   waves: true,  mouth: false, motion: 'bob',     tint: 'go',   labelKey: 'stCapturing' },
  THINKING:  { eyes: 'up',     antenna: 'orbit', waves: false, mouth: false, motion: 'still',   tint: 'wait', labelKey: 'stThinking' },
  SPEAKING:  { eyes: 'smile',  antenna: 'lit',   waves: false, mouth: true,  motion: 'bob',     tint: 'go',   labelKey: 'stSpeaking' },
};

/**
 * The parts the robot has not been given yet.
 *
 * The five faces already put each layer somewhere on the drawing — the sound
 * waves only appear while it is hearing you, the antenna only orbits while it
 * is thinking, the mouth only opens while it is speaking. So "which layer is
 * missing" has an answer in the same three places, and an unconfigured layer
 * can be drawn as the part that is not there yet rather than as a row of text
 * somewhere else.
 *
 * This is finer than steps.js on purpose and does not duplicate it. The
 * checklist answers "how many steps are left", and giving it both keys is one
 * step, one errand, one sheet. The drawing answers "what is this robot still
 * missing", and there the ears and the mind are two different absences.
 *
 * The wheels are listed from the moment calibration has not been done,
 * including while there is no car at all. Both are true then, and the plug and
 * the pale wheels say two different things: nothing is plugged in, and nothing
 * has been taught left from right.
 *
 * @typedef {'ears' | 'mind' | 'voice' | 'wheels'} Part
 * @param {import('./config.js').Config} config
 * @returns {Part[]}
 */
export function missingParts(config) {
  /** @type {Part[]} */
  const missing = [];
  if (!layerReady(config.stt)) missing.push('ears');
  if (!layerReady(config.llm)) missing.push('mind');
  if (!layerReady(config.tts)) missing.push('voice');
  // Measured, not its value — same rule as the checklist's. A car that turned
  // out NOT to be reversed has been taught just as much as one that was.
  if (config.calibration.steerSwapped === null) missing.push('wheels');
  return missing;
}

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
  root.dataset.motion = f.motion;
  root.dataset.tint = f.tint;
  return f;
}

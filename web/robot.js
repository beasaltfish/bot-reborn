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

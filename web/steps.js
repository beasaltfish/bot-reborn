// What the product still needs before it can be played with, as one answer
// rendered two ways.
//
// Spec §6: the button says "do this now" and the checklist says "here is the
// whole list and where you are in it". They are the same state. Two sources
// would drift, and a drift here reads as the product asking for one thing and
// rewarding another.

/**
 * The steps without which the car cannot move at all, in the order they have
 * to happen. Everything else is optional and is not listed until it works —
 * a row that never ticks teaches people to ignore the list.
 */
export const GATING = /** @type {const} */ (['keys', 'car', 'steer']);

/** @typedef {'keys' | 'car' | 'steer'} Step */
/** @typedef {{ keys: boolean, car: boolean, steer: boolean }} Done */

/** @type {Record<Step, import('./strings.js').StringKey>} */
const RUNG = { keys: 'fabKeys', car: 'fabPair', steer: 'fabSteer' };

/**
 * @param {Done} done
 * @param {boolean} running whether the microphone is open
 * @returns {{ step: Step | 'listen' | 'stop',
 *             tone: 'go' | 'wait' | 'stop',
 *             key: import('./strings.js').StringKey }}
 */
export function fabRung(done, running) {
  // Running outranks every unfinished step. The car can be rolling with the
  // setup half done — a previous session paired it, or calibration itself set
  // it moving — and at that moment the only button worth offering is the brake.
  if (running) return { step: 'stop', tone: 'stop', key: 'fabStop' };
  const missing = GATING.find((s) => !done[s]);
  if (missing) return { step: missing, tone: 'wait', key: RUNG[missing] };
  return { step: 'listen', tone: 'go', key: 'fabStart' };
}

/**
 * @param {Done} done
 * @returns {{ step: Step, state: 'done' | 'current' | 'todo' }[]}
 */
export function checklist(done) {
  // `current` is whatever fabRung would offer, computed the same way rather
  // than alongside it — that is what keeps the two from disagreeing.
  const current = GATING.find((s) => !done[s]);
  return GATING.map((step) => ({
    step,
    // Reports what is true, not what it expected: pairing also happens in
    // setup.html, and calibration could be done from the bench, so steps do
    // get finished out of order.
    state: done[step] ? 'done' : step === current ? 'current' : 'todo',
  }));
}

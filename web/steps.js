// What the product still needs before it can be played with, as one answer
// rendered two ways.
//
// Spec §6 asked for two renderings of one state: the button saying "do this
// now", and a checklist saying "here is the whole list and where you are in
// it". The second rendering is no longer a list. The robot shows the parts it
// has not been given — dashed arcs where hearing goes, a plug where the car
// goes — and each of those regions is the door to the step it stands for, so
// the drawing IS the list and `checklist()` has been removed rather than left
// exported with no caller.
//
// What has to stay true is what that spec was protecting: one source. The ring
// that marks the next step on the robot and the word on the button are set from
// the same fabRung() result, in the same line of app.js, so they cannot come to
// name two different steps.

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
 * What each step is called wherever it is named in full: the settings list,
 * and the label on the region of the robot that stands for it. One table, so
 * the drawing and the words cannot come to call the same step two things.
 *
 * @type {Record<Step, import('./strings.js').StringKey>}
 */
export const STEP_LABEL = { keys: 'stepKeys', car: 'stepCar', steer: 'stepSteer' };

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

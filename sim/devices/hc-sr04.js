// Selected 5 V HC-SR04 reference: see docs/hardware/sim-digital-inputs.md.
export const SONAR_DISTANCE_CM = /** @type {const} */ ([2, 400]);
/** @typedef {{distanceCm:number}} SonarStimuli */
/** @typedef {{power:'on'|'off'|'unknown',trigger:'valid'|'swapped'|'unknown',echo:'compatible'|'incompatible'|'unknown'}} Conditions */

/** @returns {SonarStimuli} */
export function defaultSonarStimuli() { return { distanceCm: 100 }; }

/** Session-only deterministic target distance; never stored as a bench property.
 * @param {SonarStimuli} state @param {unknown} value @returns {SonarStimuli}
 */
export function setSonarDistance(state, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return state;
  return { ...state, distanceCm: Math.min(SONAR_DISTANCE_CM[1], Math.max(SONAR_DISTANCE_CM[0], value)) };
}

/** Idealized single measurement. Conditions are supplied by a caller that has
 * independently established power, trigger validity and safe ECHO interfacing;
 * this function never infers 3.3 V trigger compatibility or a working divider.
 * The 58 µs/cm conversion is a nominal estimate, not an acoustic waveform.
 * @param {Conditions} conditions @param {SonarStimuli} stimuli @param {'idle'|'measure'} action
 */
export function hcSr04State(conditions, stimuli, action) {
  const noReading = (/** @type {string} */ state) => ({ state, distanceCm: null, echoDurationUs: null });
  if (conditions.power === 'off') return noReading('off');
  if (conditions.power !== 'on') return noReading('unsupported');
  if (conditions.echo === 'incompatible') return noReading('incompatible');
  if (conditions.trigger === 'swapped') return noReading('swapped');
  if (conditions.trigger !== 'valid' || conditions.echo !== 'compatible' || !['idle', 'measure'].includes(action)) return noReading('unsupported');
  if (action === 'idle') return noReading('ready');
  const distance = stimuli.distanceCm;
  if (!Number.isFinite(distance) || distance < SONAR_DISTANCE_CM[0] || distance > SONAR_DISTANCE_CM[1]) return noReading('unsupported');
  return { state: 'measured', distanceCm: distance, echoDurationUs: Math.round(distance * 58 * 1000) / 1000 };
}

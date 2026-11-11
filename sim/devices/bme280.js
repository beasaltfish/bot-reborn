/**
 * Derive simulated readings from the bus state. Firmware support is separate:
 * a working simulated sensor need not have a driver in the current firmware.
 * @param {string} instance
 * @param {{ states: Record<string, string>, firmwareSupported?: boolean }} evaluation
 * @param {ReturnType<typeof import('../stimuli.js').defaultStimuli>} stimuli
 */
export function bme280State(instance, evaluation, stimuli) {
  const state = evaluation.states[instance] ?? 'off';
  return { state, telemetry: state === 'ready' ? { ...stimuli } : null };
}

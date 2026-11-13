// Bounded hobby-servo PWM: 50 Hz, 500-2400 us pulses. Signal timing is a
// declared capability check, not a waveform simulation.
export const SERVO_PWM = /** @type {const} */ ({ frequencyHz: 50, minPulseUs: 500, maxPulseUs: 2400, angleRange: 180 });

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** @param {number} angle */
export function pulseForAngle(angle) {
  return SERVO_PWM.minPulseUs + (clamp(angle, 0, SERVO_PWM.angleRange) / SERVO_PWM.angleRange) * (SERVO_PWM.maxPulseUs - SERVO_PWM.minPulseUs);
}

/** @param {number} pulseUs */
export function angleForPulse(pulseUs) {
  return ((clamp(pulseUs, SERVO_PWM.minPulseUs, SERVO_PWM.maxPulseUs) - SERVO_PWM.minPulseUs) / (SERVO_PWM.maxPulseUs - SERVO_PWM.minPulseUs)) * SERVO_PWM.angleRange;
}

/**
 * Check a PWM command against the profile's available PWM pins.
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{ id: string, point: string|null, pin: string|null }} instance
 * @param {{ angle?: number, pulseUs?: number, frequencyHz?: number, stalled?: boolean }} [command]
 */
export function evaluatePwm(profile, instance, command = {}) {
  /** @type {import('../electrical/supply.js').ElectricalFault[]} */ const faults = [];
  if (!instance.pin || !profile.pwmPins?.includes(instance.pin)) {
    faults.push({ code: 'pwm-pin-unsupported', severity: 'warning', instances: [instance.id], points: instance.point ? [instance.point] : [], values: {} });
  }
  const frequencyHz = command.frequencyHz ?? SERVO_PWM.frequencyHz;
  if (!Number.isFinite(frequencyHz) || Math.abs(frequencyHz - SERVO_PWM.frequencyHz) > 0.5) {
    faults.push({ code: 'pwm-frequency-unsupported', severity: 'warning', instances: [instance.id], points: instance.point ? [instance.point] : [], values: { frequencyHz } });
  }
  const requested = typeof command.pulseUs === 'number' ? command.pulseUs : typeof command.angle === 'number' ? pulseForAngle(command.angle) : null;
  const pulseUs = requested === null ? null : clamp(requested, SERVO_PWM.minPulseUs, SERVO_PWM.maxPulseUs);
  const angle = typeof command.angle === 'number' ? clamp(command.angle, 0, SERVO_PWM.angleRange) : pulseUs === null ? null : angleForPulse(pulseUs);
  return {
    state: command.stalled ? 'stalled' : pulseUs === null ? 'idle' : 'moving',
    frequencyHz,
    pulseUs,
    angle,
    duty: pulseUs === null ? 0 : pulseUs * frequencyHz / 1e6,
    faults,
  };
}

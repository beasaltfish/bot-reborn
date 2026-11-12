// A bounded DC model for one LED and a series resistor. Values are volts,
// ohms, milliamps and milliwatts. This is a fixed-forward-voltage approximation.
export const DEFAULT_LED_FORWARD_VOLTAGE = 2;

/**
 * @param {{voltage:number, resistance:number, forwardVoltage:number, maxCurrentMa:number, maxPowerMw:number, currentLimitMa:number, reversed?:boolean}} circuit
 * @returns {{state:'off'|'on'|'overcurrent'|'limited', currentMa:number, ledPowerMw:number, resistorPowerMw:number, brightness:number}}
 */
export function evaluateLed(circuit) {
  const { voltage, resistance, forwardVoltage, maxCurrentMa, maxPowerMw, currentLimitMa, reversed = false } = circuit;
  if (![voltage, resistance, forwardVoltage, maxCurrentMa, maxPowerMw, currentLimitMa].every(Number.isFinite)
    || voltage < 0 || resistance < 0 || forwardVoltage <= 0 || maxCurrentMa <= 0 || maxPowerMw <= 0 || currentLimitMa <= 0) {
    throw new RangeError('invalid LED circuit parameters');
  }
  if (reversed || voltage <= forwardVoltage) return { state: 'off', currentMa: 0, ledPowerMw: 0, resistorPowerMw: 0, brightness: 0 };
  // A zero-ohm connection requests an unbounded current; the source limit is
  // the only modeled bound, and it must never be presented as a safe circuit.
  const requestedMa = resistance === 0 ? Infinity : (voltage - forwardVoltage) / resistance * 1000;
  const currentMa = Math.min(requestedMa, currentLimitMa);
  const ledPowerMw = currentMa * forwardVoltage;
  const resistorPowerMw = currentMa * currentMa * resistance / 1000;
  const state = currentMa > maxCurrentMa || ledPowerMw > maxPowerMw
    ? 'overcurrent' : requestedMa > currentLimitMa ? 'limited' : 'on';
  return { state, currentMa, ledPowerMw, resistorPowerMw, brightness: Math.min(1, currentMa / maxCurrentMa) };
}

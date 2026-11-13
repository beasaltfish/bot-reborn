// SG90 hobby servo: 5 V supply, common ground and a 50 Hz PWM signal. The
// simulator models moving/idle/stall current, not torque or inductive spikes.
import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { evaluatePwm } from '../electrical/pwm.js';

const currentFor = (/** @type {string} */ mode) => mode === 'stalled' ? 700 : mode === 'moving' ? 200 : 5;

/**
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{ controllerPowered?: boolean, electrical?: any }} electrical
 * @param {any} [stimuli]
 */
export function evaluateServo(bench, profile, { controllerPowered = false, electrical = null } = {}, stimuli = {}) {
  const network = nets(bench);
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  /** @type {Record<string, any>} */ const parts = {};
  /** @type {import('../electrical/supply.js').ElectricalFault[]} */ const faults = [];
  const addFault = (/** @type {string} */ code, /** @type {import('../electrical/supply.js').ElectricalFault['severity']} */ severity, /** @type {string[]} */ instances, /** @type {string[]} */ points, /** @type {Record<string, number>} */ values = {}) => {
    faults.push({ code, severity, instances: [...new Set(instances)].sort(), points: [...new Set(points)].sort(), values });
  };
  if (!board) return { parts, faults };
  for (const servo of bench.placed.filter(part => !part.burnt && part.part === 'sg90')) {
    const vcc = `${servo.id}:VCC`, gnd = `${servo.id}:GND`, sig = `${servo.id}:SIG`;
    const boardGround = network.same(gnd, `${board.id}:GND`);
    const gpio = PARTS.esp32.pins.map(pin => pin.name).filter(name => /^GPIO\d+$/.test(name))
      .find(name => network.same(sig, `${board.id}:${name}`)) ?? null;
    const signalPoint = gpio ? `${board.id}:${gpio}` : null;
    let powered = false, voltage = 0, reason = 'off';
    if (network.same(vcc, `${board.id}:GND`) || network.same(vcc, `${board.id}:3V3`)) reason = 'wrong-rail';
    else if (PARTS.esp32.pins.some(pin => /^GPIO\d+$/.test(pin.name) && network.same(vcc, `${board.id}:${pin.name}`))) reason = 'gpio-power';
    else if (network.same(vcc, `${board.id}:5V`)) { powered = controllerPowered; voltage = profile.rails?.['5V'] ?? 0; reason = powered ? 'board' : 'controller-off'; }
    else {
      const rail = electrical?.rails?.[network.netOf(vcc)];
      if (rail && rail.voltage > 0) { powered = true; voltage = rail.voltage; reason = 'external'; }
      else reason = [...network.members(vcc)].some(member => member !== vcc) ? 'unsupported' : 'off';
    }
    if (reason === 'gpio-power') addFault('servo-gpio-power', 'error', [servo.id, board.id], [vcc, sig], {});
    if (reason === 'wrong-rail') addFault('servo-supply-invalid', 'error', [servo.id], [vcc], {});
    if (!powered) {
      if (reason !== 'off' && reason !== 'gpio-power') addFault('device-unpowered', 'info', [servo.id], [vcc, gnd], {});
    }
    if (powered && !boardGround) addFault('source-ground-missing', 'warning', [servo.id, board.id], [gnd, `${board.id}:GND`], {});
    const command = stimuli?.servo?.[servo.id] ?? stimuli?.servos?.[servo.id] ?? {};
    const pwm = evaluatePwm(profile, { id: servo.id, point: signalPoint, pin: gpio }, command);
    faults.push(...pwm.faults);
    const moving = pwm.state === 'moving';
    const currentMa = powered && boardGround ? currentFor(pwm.state) : 0;
    const railState = electrical?.rails?.[network.netOf(vcc)];
    const limited = railState?.status === 'limited';
    if (powered && limited) addFault('rail-brownout', 'warning', [servo.id], [vcc, gnd], { voltage: 0 });
    parts[servo.id] = {
      state: !powered ? (reason === 'unsupported' ? 'unsupported' : 'off') : !boardGround ? 'unsupported' : pwm.state === 'stalled' ? 'stalled' : moving ? 'moving' : 'ready',
      angle: pwm.angle,
      pulseUs: pwm.pulseUs,
      frequencyHz: pwm.frequencyHz,
      currentMa,
      supplyVoltage: powered ? voltage : 0,
    };
  }
  return { parts, faults };
}

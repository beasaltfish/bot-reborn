// TB6612FNG channel A plus a small DC motor. The driver needs logic and motor
// supplies, common ground, STBY high and a PWM-capable input. Loads are explicit
// stimuli; torque, inductance and thermal behaviour are not modeled.
import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { DEVICES } from './catalog.js';

export const MOTOR_CURRENT_MA = /** @type {const} */ ({ idle: 100, load: 400, stall: 1200 });

/** @param {any} network @param {string} driverId @param {string} pin @param {string} boardId */
function gpioOn(network, driverId, pin, boardId) {
  return PARTS.esp32.pins.map(item => item.name).filter(name => /^GPIO\d+$/.test(name))
    .find(name => network.same(`${driverId}:${pin}`, `${boardId}:${name}`)) ?? null;
}

/**
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{ controllerPowered?: boolean, electrical?: any }} electrical
 * @param {any} [stimuli]
 */
export function evaluateMotorDriver(bench, profile, { controllerPowered = false, electrical = null } = {}, stimuli = {}) {
  const network = nets(bench);
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  /** @type {Record<string, any>} */ const parts = {};
  /** @type {import('../electrical/supply.js').ElectricalFault[]} */ const faults = [];
  const addFault = (/** @type {string} */ code, /** @type {import('../electrical/supply.js').ElectricalFault['severity']} */ severity, /** @type {string[]} */ instances, /** @type {string[]} */ points, /** @type {Record<string, number>} */ values = {}) => {
    faults.push({ code, severity, instances: [...new Set(instances)].sort(), points: [...new Set(points)].sort(), values });
  };
  if (!board) return { parts, faults };
  for (const driver of bench.placed.filter(part => !part.burnt && part.part === 'tb6612fng')) {
    const command = stimuli?.motor?.[driver.id] ?? {};
    const direction = ['forward', 'reverse', 'coast', 'brake'].includes(command.direction) ? command.direction : 'coast';
    const load = command.load === 'stall' ? 'stall' : command.load === 'load' ? 'load' : 'idle';
    const speed = typeof command.speed === 'number' ? Math.min(1, Math.max(0, command.speed)) : 0.5;
    const vm = `${driver.id}:VM`, vcc = `${driver.id}:VCC`, gnd = `${driver.id}:GND2`;
    const boardGround = network.same(gnd, `${board.id}:GND`);
    const gpioPins = PARTS.esp32.pins.map(pin => pin.name).filter(name => /^GPIO\d+$/.test(name));
    const onGpio = (/** @type {string} */ point) => gpioPins.some(name => network.same(point, `${board.id}:${name}`));
    if (onGpio(vm) || onGpio(vcc)) addFault('driver-gpio-power', 'error', [driver.id, board.id], [vm, vcc], {});
    const rail = electrical?.rails?.[network.netOf(vm)];
    const external = !!rail && rail.voltage > 0;
    const vmPowered = network.same(vm, `${board.id}:5V`) ? controllerPowered : external;
    const vccPowered = network.same(vcc, `${board.id}:3V3`) || network.same(vcc, `${board.id}:5V`) ? controllerPowered : external;
    if (!vmPowered || !vccPowered) addFault('device-unpowered', 'info', [driver.id], [vm, vcc], {});
    if (!boardGround) addFault('source-ground-missing', 'warning', [driver.id, board.id], [gnd, `${board.id}:GND`], {});
    const stbyPoint = `${driver.id}:STBY`;
    const stbyHigh = network.same(stbyPoint, `${board.id}:3V3`) || network.same(stbyPoint, `${board.id}:5V`) || command.standby === true;
    if (vmPowered && vccPowered && !stbyHigh) addFault('motor-standby', 'warning', [driver.id], [stbyPoint], {});
    const ain1 = gpioOn(network, driver.id, 'AIN1', board.id), ain2 = gpioOn(network, driver.id, 'AIN2', board.id);
    if (ain1 && ain1 === ain2) addFault('motor-bridge-shorted', 'destructive', [driver.id], [`${driver.id}:AIN1`, `${driver.id}:AIN2`], {});
    const pwma = gpioOn(network, driver.id, 'PWMA', board.id);
    if (!pwma || !profile.pwmPins?.includes(pwma)) addFault('motor-pwm-pin', 'warning', [driver.id], [`${driver.id}:PWMA`], {});
    if (direction !== 'coast' && (!ain1 || !ain2)) addFault('motor-direction-missing', 'warning', [driver.id], [`${driver.id}:AIN1`, `${driver.id}:AIN2`], {});
    // Find the motor bridged across AO1/AO2, in either orientation.
    const motors = bench.placed.filter(part => part.part === 'dc-motor-small');
    const motor = motors.find(part => (network.same(`${part.id}:+`, `${driver.id}:AO1`) && network.same(`${part.id}:-`, `${driver.id}:AO2`))
      || (network.same(`${part.id}:+`, `${driver.id}:AO2`) && network.same(`${part.id}:-`, `${driver.id}:AO1`)));
    if (!motor) { addFault('motor-missing', 'info', [driver.id], [`${driver.id}:AO1`, `${driver.id}:AO2`], {}); continue; }
    const crossed = network.same(`${motor.id}:+`, `${driver.id}:AO2`);
    const running = vmPowered && vccPowered && boardGround && stbyHigh && direction !== 'coast' && direction !== 'brake';
    const currentMa = !running ? 0 : load === 'stall' ? MOTOR_CURRENT_MA.stall : load === 'load' ? MOTOR_CURRENT_MA.load : MOTOR_CURRENT_MA.idle;
    if (load === 'stall' && running) addFault('motor-stall-current', 'warning', [motor.id, driver.id], [`${motor.id}:+`, `${motor.id}:-`], { currentMa });
    const railLimited = external && rail?.status === 'limited' && currentMa > 0;
    if (railLimited) addFault('rail-brownout', 'warning', [motor.id, driver.id], [vm, gnd], { voltage: 0 });
    /** @type {'off'|'idle'|'forward'|'reverse'|'brake'|'coast'|'stalled'|'burnt'} */
    let state = 'off';
    if (motor.burnt || driver.burnt) state = 'burnt';
    else if (!vmPowered || !vccPowered || !boardGround || !stbyHigh) state = 'off';
    else if (direction === 'coast') state = 'coast';
    else if (direction === 'brake') state = 'brake';
    else if (load === 'stall') state = 'stalled';
    else state = (direction === 'forward') !== crossed ? 'forward' : 'reverse';
    parts[motor.id] = {
      state,
      direction: direction === 'coast' || direction === 'brake' ? direction : state,
      rpmRatio: running && load !== 'stall' ? speed : 0,
      currentMa,
      supplyVoltage: vmPowered ? (network.same(vm, `${board.id}:5V`) ? profile.rails?.['5V'] ?? 0 : rail?.voltage ?? 0) : 0,
    };
    parts[driver.id] = { state, currentMa, pwmPin: pwma };
  }
  return { parts, faults };
}

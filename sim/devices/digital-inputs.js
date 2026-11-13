// Digital input modules: a KY-004 button module and the HC-SR04 sonar. Both
// derive their signal behaviour from the actual nets and a bounded session
// stimulus; firmware pin modes are not inferred.
import { nets } from '../netlist.js';
import { PARTS } from '../parts.js';
import { evaluateGpio } from '../electrical/gpio.js';
import { DEVICES } from './catalog.js';
import { hcSr04State, setSonarDistance } from './hc-sr04.js';

/** @typedef {'off'|'ready'|'pressed'|'unsupported'} ButtonState */
/** @typedef {{ state: ButtonState, level: 'high'|'low'|null, supplyVoltage: number }} ButtonResult */
/** @typedef {{ state: string, distanceCm: number|null, echoDurationUs: number|null, supplyVoltage: number }} SonarResult */

/** @param {import('../bench.js').Bench} bench @param {any} network @param {string} id @param {string} vcc @param {string} gnd @param {any} profile @param {boolean} controllerPowered @param {any} electrical @param {Record<string, any>} devices */
function supplyFor(bench, network, id, vcc, gnd, profile, controllerPowered, electrical, devices) {
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  if (!board) return { powered: false, voltage: 0, reason: 'no-controller' };
  const vccPoint = `${id}:${vcc}`, gndPoint = `${id}:${gnd}`;
  if (network.same(vccPoint, `${board.id}:GND`) || network.same(gndPoint, `${board.id}:5V`) || network.same(gndPoint, `${board.id}:3V3`)) {
    return { powered: false, voltage: 0, reason: 'reversed' };
  }
  for (const rail of ['5V', '3V3']) {
    if (network.same(vccPoint, `${board.id}:${rail}`) && network.same(gndPoint, `${board.id}:GND`)) {
      return { powered: controllerPowered, voltage: profile.rails?.[rail] ?? 0, reason: controllerPowered ? 'board' : 'controller-off' };
    }
  }
  const rail = electrical?.rails?.[network.netOf(vccPoint)];
  if (!rail || rail.voltage <= 0) {
    const connected = [...network.members(vccPoint), ...network.members(gndPoint)].some(member => member !== vccPoint && member !== gndPoint);
    return { powered: false, voltage: 0, reason: connected ? 'unsupported' : 'off' };
  }
  const source = bench.placed.find(part => rail.sourceInstances.includes(part.id));
  const capability = source ? (devices[source.part]?.capabilities ?? []).find((/** @type {any} */ cap) => ['source', 'battery', 'regulator'].includes(cap.kind)) : undefined;
  const groundPin = capability?.negative ?? capability?.ground;
  if (!source || !groundPin || !network.same(gndPoint, `${source.id}:${groundPin}`)) return { powered: false, voltage: 0, reason: 'unsupported' };
  return { powered: true, voltage: rail.voltage, reason: 'external' };
}

/** @param {any} network @param {string} point @param {string} boardId */
function gpioOn(network, point, boardId) {
  return PARTS.esp32.pins.map(pin => pin.name).filter(name => /^GPIO\d+$/.test(name))
    .filter(name => network.same(point, `${boardId}:${name}`));
}

/** Is the signal pad on a direct net, with no passive component in between?
 * @param {any} network @param {string} point @param {string} partId @param {string} boardId */
function directSignal(network, point, partId, boardId) {
  const members = network.members(point);
  return members.every((/** @type {string} */ member) => member.startsWith(`${partId}:`) || member.startsWith(`${boardId}:`) || member.startsWith('bb'));
}

/**
 * Evaluate button modules and HC-SR04 sensors on the bench.
 * @param {import('../bench.js').Bench} bench
 * @param {import('../devices/profiles.js').Profile} profile
 * @param {{ controllerPowered?: boolean, electrical?: any }} electrical
 * @param {any} [stimuli]
 * @param {Record<string, any>} [devices]
 * @returns {{ parts: Record<string, ButtonResult|SonarResult>, gpio: Record<string, string>, faults: import('../electrical/supply.js').ElectricalFault[] }}
 */
export function evaluateDigitalInputs(bench, profile, { controllerPowered = false, electrical = null } = {}, stimuli = {}, devices = DEVICES) {
  const network = nets(bench);
  const board = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  /** @type {Record<string, ButtonResult|SonarResult>} */ const parts = {};
  /** @type {import('../electrical/supply.js').ElectricalFault[]} */ const faults = [];
  const addFault = (/** @type {string} */ code, /** @type {import('../electrical/supply.js').ElectricalFault['severity']} */ severity, /** @type {string[]} */ instances, /** @type {string[]} */ points, /** @type {Record<string, number>} */ values = {}) => {
    faults.push({ code, severity, instances: [...new Set(instances)].sort(), points: [...new Set(points)].sort(), values });
  };
  if (!board) return { parts, gpio: {}, faults };
  /** @type {import('../electrical/gpio.js').Declaration[]} */ const declarations = [];
  /** @type {import('../electrical/gpio.js').ExternalDriver[]} */ const drivers = [];

  for (const part of bench.placed.filter(p => !p.burnt && (p.part === 'button-module' || p.part === 'hc-sr04'))) {
    if (part.part === 'button-module') {
      const supply = supplyFor(bench, network, part.id, 'VCC', 'GND', profile, controllerPowered, electrical, devices);
      const override = stimuli?.buttons?.[part.id] ?? stimuli?.[`button.${part.id}.pressed`];
      const pressed = typeof override === 'boolean' ? override : part.properties.pressed === true;
      const pins = gpioOn(network, `${part.id}:S`, board.id);
      for (const pin of pins) declarations.push({ point: `${board.id}:${pin}`, direction: 'input', pull: 'none' });
      if (supply.powered) drivers.push({ point: `${part.id}:S`, ground: `${part.id}:GND`, powered: true, level: pressed ? 'low' : 'high', highVoltage: supply.voltage });
      parts[part.id] = {
        state: supply.powered ? (pressed ? 'pressed' : 'ready') : supply.reason === 'reversed' ? 'unsupported' : 'off',
        level: supply.powered ? (pressed ? 'low' : 'high') : null,
        supplyVoltage: supply.voltage,
      };
      if (supply.reason === 'reversed') addFault('reverse-polarity', 'error', [part.id], [`${part.id}:VCC`, `${part.id}:GND`], { voltage: 0 });
      else if (!supply.powered) addFault('device-unpowered', 'info', [part.id], [`${part.id}:VCC`, `${part.id}:GND`], {});
      continue;
    }

    const supply = supplyFor(bench, network, part.id, 'VCC', 'GND', profile, controllerPowered, electrical, devices);
    const trig = gpioOn(network, `${part.id}:TRIG`, board.id);
    const echo = gpioOn(network, `${part.id}:ECHO`, board.id);
    const trigDirect = trig.length === 1 && directSignal(network, `${part.id}:TRIG`, part.id, board.id);
    const echoDirect = echo.length === 1 && directSignal(network, `${part.id}:ECHO`, part.id, board.id);
    const resources = devices[part.part]?.firmware?.resources ?? [];
    const trigPin = resources.find((/** @type {any} */ r) => r.kind === 'gpio' && r.pin === 'TRIG')?.gpio;
    const echoPin = resources.find((/** @type {any} */ r) => r.kind === 'gpio' && r.pin === 'ECHO')?.gpio;
    const swapped = Boolean((trig[0] && trig[0] === echoPin) || (echo[0] && echo[0] === trigPin));
    const echoCompatible = echoDirect ? supply.voltage <= profile.gpioVoltage : null;
    const conditions = {
      power: supply.powered ? 'on' : supply.reason === 'unsupported' ? 'unknown' : 'off',
      trigger: swapped ? 'swapped' : trigDirect && echoDirect ? 'valid' : 'unknown',
      echo: echoCompatible === null ? 'unknown' : echoCompatible ? 'compatible' : 'incompatible',
    };
    const measure = stimuli?.sonar?.measure === true;
    const distance = setSonarDistance({ distanceCm: 100 }, stimuli?.sonar?.distanceCm);
    const result = hcSr04State(/** @type {any} */ (conditions), distance, measure ? 'measure' : 'idle');
    parts[part.id] = { ...result, supplyVoltage: supply.voltage };
    if (echoDirect) {
      declarations.push({ point: `${board.id}:${echo[0]}`, direction: 'input', pull: 'none' });
      drivers.push({ point: `${part.id}:ECHO`, ground: `${part.id}:GND`, powered: supply.powered, level: measure ? 'high' : 'low', highVoltage: supply.voltage || 5 });
    }
    if (trigDirect) declarations.push({ point: `${board.id}:${trig[0]}`, direction: 'output', level: measure ? 'high' : 'low' });
    if (swapped) addFault('hc-sr04-swapped', 'error', [part.id], [`${part.id}:TRIG`, `${part.id}:ECHO`], {});
    if (!supply.powered) addFault('device-unpowered', 'info', [part.id], [`${part.id}:VCC`, `${part.id}:GND`], {});
    if (echoDirect && supply.powered && echoCompatible === false) addFault('logic-level-incompatible', 'warning', [part.id], [`${part.id}:ECHO`, `${board.id}:${echo[0]}`], { highVoltage: supply.voltage, gpioVoltage: profile.gpioVoltage });
  }

  if (!declarations.length) return { parts, gpio: {}, faults };
  const gpio = evaluateGpio(bench, profile, declarations, { controllerPowered, drivers });
  return { parts, gpio: gpio.states, faults: [...faults, ...gpio.faults] };
}

import { nets } from '../netlist.js';
import { evaluateI2c } from '../electrical/i2c.js';
import { bme280State } from './bme280.js';
import { bme280Wiring } from './bme280-wiring.js';
import { defaultStimuli, setStimulus } from '../stimuli.js';

/** Evaluate only direct 3.3 V ESP32-powered BME280 networks. Other supplies,
 * extra bus loads, pull-up sizing and I2C timing are not solved.
 * @param {import('../bench.js').Bench} bench
 * @param {import('./profiles.js').Profile} profile
 * @param {boolean} controllerPowered
 * @param {object|undefined} input
 */
export function evaluateBme280Bench(bench, profile, controllerPowered, input) {
  const sensors = bench.placed.filter(part => part.part === 'bme280-i2c');
  const controller = bench.placed.find(part => part.part === 'esp32' && !part.burnt);
  const network = nets(bench);
  let stimuli = defaultStimuli();
  for (const key of /** @type {const} */ (['temperatureC', 'humidityPct', 'pressureHpa'])) {
    stimuli = setStimulus(stimuli, key, input && Object.hasOwn(input, key) ? /** @type {Record<string,unknown>} */ (input)[key] : undefined);
  }
  /** @type {Record<string,string>} */ const states = {};
  /** @type {import('../electrical/supply.js').ElectricalFault[]} */ const faults = [];
  /** @param {string} code @param {string[]} ids @param {string[]} points */
  const fault = (code, ids, points) => faults.push({ code, severity: 'warning', instances: [...ids].sort(), points: [...new Set(points)].sort(), values: {} });
  const wiring = new Map(sensors.map(sensor => [sensor.id, bme280Wiring(bench, sensor.id)]));
  const powered = (/** @type {import('../bench.js').Placed} */ sensor) => !!controller && controllerPowered && !sensor.burnt
    && network.same(`${sensor.id}:VIN`, `${controller.id}:3V3`) && network.same(`${sensor.id}:GND`, `${controller.id}:GND`);
  const eligible = new Set(sensors.filter(sensor => powered(sensor) && wiring.get(sensor.id)?.supported).map(sensor => sensor.id));
  /** @type {{id:string,sda:string,scl:string,address:number}[]} */ const instances = [];
  for (const sensor of sensors) {
    const id = sensor.id, pins = [`${id}:SDI`, `${id}:SCK`];
    const config = wiring.get(id);
    states[id] = 'off';
    if (!config?.supported) {
      states[id] = 'unsupported';
      fault('unsupported-electrical-network', [id], config?.points ?? []);
      continue;
    }
    if (!powered(sensor)) {
      if (controllerPowered && !sensor.burnt) fault('i2c-unpowered', [id], [`${id}:VIN`, `${id}:GND`]);
      continue;
    }
    if (!Number.isFinite(profile.gpioVoltage) || !Number.isFinite(profile.rails['3V3']) || Math.abs(profile.gpioVoltage - profile.rails['3V3']) > 0.05) {
      states[id] = 'unsupported'; fault('unsupported-electrical-network', [id], pins); continue;
    }
    const allowed = new Set([
      ...profile.i2cBuses.flatMap(bus => [`${controller?.id}:${bus.sda}`, `${controller?.id}:${bus.scl}`]),
      ...[...eligible].flatMap(other => [`${other}:SDI`, `${other}:SCK`]),
    ]);
    const placedIds = new Set(bench.placed.map(part => part.id));
    const unexpected = [...new Set(pins.flatMap(pin => network.members(pin)).filter(point => placedIds.has(point.slice(0, point.indexOf(':'))) && !allowed.has(point)))];
    if (unexpected.length) {
      states[id] = 'unsupported'; fault('unsupported-electrical-network', [id], [...pins, ...unexpected]); continue;
    }
    instances.push({ id, sda: 'SDI', scl: 'SCK', address: /** @type {number} */ (config.address) });
  }
  const i2c = evaluateI2c(bench, profile, instances, { controllerPowered, devices: Object.fromEntries(instances.map(item => [item.id, { status: 'ok' }])) });
  Object.assign(states, i2c.states);
  // A miswired peer can drive or load either bus line unpredictably. Do not
  // claim a second device is readable merely because its own pins match.
  for (const item of instances) {
    if (i2c.states[item.id] !== 'ready') continue;
    const pins = [`${item.id}:SDI`, `${item.id}:SCK`];
    const peers = instances.filter(other => other.id !== item.id && ['swapped', 'shorted', 'wrong-bus'].includes(i2c.states[other.id])
      && pins.some(pin => [`${other.id}:SDI`, `${other.id}:SCK`].some(otherPin => network.same(pin, otherPin))));
    if (peers.length) {
      states[item.id] = 'unsupported';
      fault('unsupported-electrical-network', [item.id, ...peers.map(peer => peer.id)], [...pins, ...peers.flatMap(peer => [`${peer.id}:SDI`, `${peer.id}:SCK`])]);
    }
  }
  for (const issue of i2c.faults) fault(issue.code, issue.instances, issue.points);
  return { states, faults, buses: i2c.buses, parts: Object.fromEntries(sensors.map(sensor => [sensor.id, bme280State(sensor.id, { states }, stimuli)])) };
}

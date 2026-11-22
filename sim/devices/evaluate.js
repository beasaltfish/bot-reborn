import { evaluateElectrical } from '../electrical/evaluate.js';
import { evaluateGpioLed, evaluateLedBench } from '../electrical/led-bench.js';
import { dcSourceSafety } from '../electrical/dc-source-safety.js';
import { bme280PullupSafety } from '../electrical/bme280-pullup-safety.js';
import { boardGpioSafety } from '../electrical/board-gpio-safety.js';
import { poweredOutputSafety } from '../electrical/powered-output-safety.js';
import { blockingBoardPowerFault } from '../board-power-gate.js';
import { evaluateBme280Bench } from './bme280-evaluate.js';
import { evaluateDigitalInputs } from './digital-inputs.js';
import { evaluateSsd1306 } from './ssd1306.js';
import { evaluateServo } from './servo.js';
import { evaluateMotorDriver } from './motor-driver.js';
import { evaluateWs2812 } from './ws2812.js';
import { powerOn } from '../power.js';
import { DEVICES } from './catalog.js';
import { PROFILES, checkResources } from './profiles.js';
import { ownershipIssues } from '../firmware/ownership.js';

/** @typedef {{ profile?: import('./profiles.js').Profile, mode?: import('../electrical/supply.js').OperatingMode, stimuli?: object, devices?: Record<string, any>, ownership?: Record<string, 'board'|'circuit'|'unknown'>, deviceStates?: Record<string, string>, gpioOutputs?: Record<string, 'high'|'low'|'high-z'>, ioPins?: Set<number>, initializing?: boolean, firmware?: any }} Options */

/** Deduplicate global findings by code and affected instances. */
/** @param {{code:string, instances:string[], points:string[], origin?:string}[]} faults */
export function uniqueFaults(faults) {
  const sorted = faults.map(f => ({ ...f, instances: [...f.instances].sort(), points: [...f.points].sort() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const merged = new Map();
  for (const f of sorted) {
    const key = JSON.stringify([f.code, f.instances, f.origin ?? '']);
    const previous = merged.get(key);
    if (previous) previous.points = [...new Set([...previous.points, ...f.points])].sort();
    else merged.set(key, f);
  }
  return [...merged.values()];
}

/**
 * Evaluate physical and firmware constraints independently.
 * @param {import('../bench.js').Bench} bench
 * @param {Options} [options]
 */
export function evaluateDevices(bench, { profile = PROFILES[0], mode = 'idle', stimuli, devices = DEVICES, ownership = {}, deviceStates = {}, gpioOutputs = {}, ioPins = new Set(), initializing = false, firmware } = {}) {
  const electrical = evaluateElectrical(bench, { profile, mode, stimuli, devices });
  const resources = checkResources(bench, profile, devices, { ownership, drivers: firmware?.drivers, firmware }).filter(f => {
    if (f.code !== 'spi-chip-select-conflict' || f.instances.length !== 2) return true;
    const [a, b] = f.instances.map(id => bench.placed.find(p => p.id === id));
    // The built-in firmware deliberately broadcasts to identical supported panels.
    return !(a && b && a.part === b.part && devices[a.part] === DEVICES[a.part]
      && DEVICES[a.part]?.category === 'display' && Boolean(firmware?.drivers?.includes(a.part)));
  });
  // Keep the bounded LED experiment visible in the shared diagnosis without
  // pretending the generic supply solver supports arbitrary LED networks.
  // A GPIO level is a modeled source/sink, so the same LED model covers both;
  // when the pin is not driving the LED, the DC-source model answers.
  const ledResults = devices['led-5mm'] === DEVICES['led-5mm'] ? bench.placed
    .filter(p => p.part === 'led-5mm')
    .map(p => {
      const driven = evaluateGpioLed(bench, p.id, gpioOutputs, profile);
      const fromGpio = driven.state !== 'off';
      return { id: p.id, fromGpio, pin: driven.gpio, outcome: fromGpio ? driven : evaluateLedBench(bench, p.id) };
    }) : [];
  /** @type {Record<string, {code:string, severity:import('../electrical/supply.js').ElectricalFault['severity']}>} */
  const ledCodes = {
    unsupported: { code: 'unsupported-electrical-network', severity: 'error' },
    reversed: { code: 'led-reversed', severity: 'warning' },
    overcurrent: { code: 'led-overcurrent', severity: 'destructive' },
    burnt: { code: 'led-burnt', severity: 'error' },
    limited: { code: 'led-current-limited', severity: 'info' },
  };
  const ledFaults = ledResults.flatMap(({ id, outcome, fromGpio }) => {
    if (fromGpio && outcome.state === 'overcurrent') {
      return [{ code: 'gpio-overcurrent', severity: /** @type {const} */ ('destructive'), instances: [id], points: [`${id}:A`, `${id}:K`], values: { currentMa: outcome.currentMa } }];
    }
    const diagnostic = ledCodes[outcome.state];
    const values = outcome.state === 'overcurrent' || outcome.state === 'limited' ? { currentMa: outcome.currentMa } : {};
    return diagnostic ? [{ ...diagnostic, instances: [id], points: [`${id}:A`, `${id}:K`], values }] : [];
  });
  const sourceFaults = devices['dc-source'] === DEVICES['dc-source'] ? dcSourceSafety(bench, profile) : [];
  const pullupFaults = devices['bme280-i2c'] === DEVICES['bme280-i2c'] ? bme280PullupSafety(bench, profile) : [];
  const boardGpioFaults = devices.esp32 === DEVICES.esp32 ? boardGpioSafety(bench, profile) : [];
  const sonarFaults = devices['hc-sr04'] === DEVICES['hc-sr04'] ? poweredOutputSafety(bench, profile, { part: 'hc-sr04', supplyPin: 'VCC', signalPins: ['ECHO'], directCode: 'logic-level-incompatible' }) : [];
  const basicFaults = [...electrical.faults, ...resources, ...ledFaults, ...sourceFaults, ...pullupFaults, ...boardGpioFaults, ...sonarFaults];
  const board = bench.placed.some(part => ['bme280-i2c', 'button-module', 'hc-sr04', 'ssd1306', 'sg90', 'tb6612fng', 'ws2812-strip'].includes(part.part)) ? powerOn(bench) : null;
  const controllerPowered = !!board && board.esp === 'ok' && !blockingBoardPowerFault(bench, { faults: [...board.faults, ...basicFaults] });
  const sensor = board && devices['bme280-i2c'] === DEVICES['bme280-i2c'] && bench.placed.some(part => part.part === 'bme280-i2c')
    ? evaluateBme280Bench(bench, profile, controllerPowered, stimuli)
    : null;
  const digital = board ? evaluateDigitalInputs(bench, profile, { controllerPowered, electrical }, stimuli, devices) : { parts: {}, gpio: {}, faults: [] };
  const display = board ? evaluateSsd1306(bench, profile, { controllerPowered, electrical }, stimuli, devices) : { parts: {}, faults: [] };
  const servo = board ? evaluateServo(bench, profile, { controllerPowered, electrical }, stimuli) : { parts: {}, faults: [] };
  const motor = board ? evaluateMotorDriver(bench, profile, { controllerPowered, electrical }, stimuli) : { parts: {}, faults: [] };
  const strip = board ? evaluateWs2812(bench, profile, { controllerPowered, electrical }, stimuli) : { parts: {}, faults: [] };
  const aggregateFaults = [];
  /** @type {Map<string, number>} */ const extraLoads = new Map();
  for (const load of [...Object.values(servo.parts), ...Object.values(motor.parts), ...Object.values(strip.parts)]) {
    if (!load?.supplyNet || !load.currentMa) continue;
    extraLoads.set(load.supplyNet, (extraLoads.get(load.supplyNet) ?? 0) + load.currentMa);
  }
  for (const [net, extra] of extraLoads) {
    const rail = electrical.rails[net];
    if (!rail || rail.currentLimitMa === undefined) continue;
    rail.requestedCurrentMa += extra;
    if (rail.requestedCurrentMa > rail.currentLimitMa) {
      rail.status = 'limited'; rail.voltage = 0;
      aggregateFaults.push({ code: 'rail-brownout', severity: 'warning', instances: rail.sourceInstances, points: [net], values: { requestedCurrentMa: rail.requestedCurrentMa, currentLimitMa: rail.currentLimitMa } });
    }
  }
  const faults = uniqueFaults([...basicFaults, ...(sensor?.faults ?? []), ...digital.faults, ...display.faults, ...servo.faults, ...motor.faults, ...strip.faults, ...aggregateFaults, ...ownershipIssues(bench)]);
  const bme280 = sensor?.parts ?? {};
  const parts = Object.fromEntries(Object.entries(electrical.devices).map(([id, state]) => [id, { electrical: state }]));
  const burns = [...new Set([...electrical.burns, ...ledResults.filter(({ outcome }) => outcome.state === 'overcurrent').map(({ id }) => id)])].sort();
  /** A board device only speaks when its firmware initialised it; circuit devices always do. */
  /** @param {Record<string, any>} record */
  const gate = (record) => Object.fromEntries(Object.entries(record).filter(([id]) => {
    if (initializing) return true;
    const own = ownership[id];
    if (own === 'circuit') return true;
    if (own === 'board') return deviceStates[id] === 'active';
    if (own === 'unknown') return false;
    return true;
  }));
  const leds = Object.fromEntries(ledResults.flatMap(({ id, outcome, fromGpio, pin }) => {
    if (!initializing) {
      const own = ownership[id];
      if (own === 'unknown') return [];
      // A board-owned LED normally waits for the firmware to claim it. A plugin
      // command owns its pins instead, so an LED it drives is admitted without
      // pretending the firmware initialised it.
      const byIo = fromGpio && Number.isInteger(pin) && ioPins.has(/** @type {number} */ (pin));
      if (own === 'board' && deviceStates[id] !== 'active' && !byIo) return [];
    }
    return [[id, { ...outcome, source: fromGpio ? 'gpio' : 'supply' }]];
  }));
  return {
    electrical, resources, parts, faults, burns, deviceStates, ownership, leds,
    bme280: gate(bme280),
    digital: gate(digital.parts),
    gpio: digital.gpio,
    display: gate(display.parts),
    servo: gate(servo.parts),
    motor: gate(motor.parts),
    strip: gate(strip.parts),
  };
}

/**
 * Preserve the legacy result while supplying a merged view for presentation.
 * @param {import('../bench.js').Bench} bench
 * @param {Options} [options]
 */
export function evaluateBench(bench, options = {}) {
  const legacy = powerOn(bench);
  const engineering = evaluateDevices(bench, options);
  const parts = { ...engineering.parts };
  for (const [id, state] of Object.entries(legacy.parts)) parts[id] = { ...engineering.parts[id], ...state };
  return { legacy, engineering, parts, faults: [...legacy.faults, ...engineering.faults], burns: [...new Set([...legacy.burns, ...engineering.burns])].sort() };
}

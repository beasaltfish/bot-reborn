import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire, addPart } from '../../sim/bench.js';
import { TARGET, targetFor } from '../../sim/target.js';
import { diagnose } from '../../sim/diagnose.js';
import { powerOn } from '../../sim/power.js';
import { evaluateBench, evaluateDevices } from '../../sim/devices/evaluate.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { DEVICES } from '../../sim/devices/catalog.js';

const model = (/** @type {number} */ voltage) => ({ ...DEVICES,
  esp32: { ...DEVICES.esp32, capabilities: [{ kind: 'source', positive: 'GPIO21', negative: 'GND', voltage, currentLimitMa: 100, internalResistanceOhm: 0 }] },
  inmp441: { ...DEVICES.inmp441, capabilities: [{ kind: 'supply', positive: 'VDD', ground: 'GND', currentsMa: { idle: 10 }, minVoltage: 3, maxVoltage: 3.6 }] },
});
const fixture = () => {
  let b = { ...emptyBench(), usb: true };
  b = addWire(b, 'esp:GPIO21', 'mic:VDD', 'red');
  return addWire(b, 'esp:GND', 'mic:GND', 'black');
};

test('electrically valid is separate from firmware support', () => {
  const profile = { ...PROFILES[0], supportedParts: PROFILES[0].supportedParts.filter(p => p !== 'inmp441') };
  const result = evaluateDevices(fixture(), { profile, mode: 'idle', devices: model(3.3) });
  assert.equal(result.electrical.devices.mic.status, 'ok');
  assert.ok(result.resources.some(f => f.code === 'firmware-unsupported' && f.instances.includes('mic')));
  assert.ok(!result.burns.includes('mic'));
});

test('destructive electrical faults burn once even with multiple loads', () => {
  const devices = model(5);
  devices.inmp441.capabilities.push(devices.inmp441.capabilities[0]);
  const result = evaluateDevices(fixture(), { profile: PROFILES[0], mode: 'idle', devices });
  assert.deepEqual(result.burns, ['mic']);
  assert.equal(result.faults.filter(f => f.code === 'device-overvoltage').length, 1);
});

test('legacy audio result is unchanged', () => {
  let b = { ...emptyBench(), usb: true };
  for (const l of TARGET) b = addWire(b, l.a, l.b, 'red');
  const result = evaluateBench(b);
  assert.deepEqual(result.legacy, powerOn(b));
  assert.deepEqual(result.parts.mic, result.legacy.parts.mic);
});

test('same-model displays share the target bus without a conflict', () => {
  let b = { ...emptyBench(), usb: true };
  b = addPart(b, 'screen-ili9341-ips', { x: 0, z: 40 }).bench;
  b = addPart(b, 'screen-ili9341-ips', { x: 0, z: 60 }).bench;
  for (const l of targetFor(b)) b = addWire(b, l.a, l.b, 'red');
  const result = evaluateBench(b);
  assert.equal(/** @type {any} */ (result.legacy.parts.scr).show, 'ready');
  assert.equal(/** @type {any} */ (result.legacy.parts.scr2).show, 'ready');
  assert.deepEqual(result.faults, []);
});

test('repeated resource conflicts retain all affected pins', () => {
  let b = emptyBench();
  b = addPart(b, 'toy', { x: 0, z: 0 }).bench;
  b = addPart(b, 'toy', { x: 0, z: 0 }).bench;
  b = addWire(b, 'toy:U3A', 'toy2:U3A', 'red');
  b = addWire(b, 'toy:U3B', 'toy2:U3B', 'red');
  const devices = { ...DEVICES, toy: { ...DEVICES.toy, capabilities: /** @type {any} */ ([{ kind: 'pwm', pin: 'U3A' }, { kind: 'pwm', pin: 'U3B' }]) } };
  const faults = evaluateDevices(b, { devices }).faults.filter(f => f.code === 'resource-pin-conflict');
  assert.equal(faults.length, 1);
  assert.deepEqual(faults[0].points, ['toy2:U3A', 'toy2:U3B', 'toy:U3A', 'toy:U3B'].sort());
});

test('generic electrical and resource diagnoses explain cause and remedy', () => {
  const b = fixture();
  const outcome = powerOn(b);
  outcome.faults = [{ code: 'device-overvoltage', points: ['mic:VDD'] }, { code: 'firmware-unsupported', points: ['mic:VDD'] }];
  const hints = diagnose(b, outcome).filter(h => h.kind === 'fault');
  assert.match(hints[0].text, /voltage.*replace/i);
  assert.match(hints[1].text, /firmware.*support/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS } from '../../sim/parts.js';
import { DEVICES, deviceByPart } from '../../sim/devices/catalog.js';
import { validateDeviceCatalogue } from '../../sim/devices/validate.js';

const firmware = () => ({ libraries: [], resources: [], init: {}, actions: [], telemetry: [] });
/** @param {string} part @returns {any} */
const row = (part) => ({ part, category: 'test', summaryKey: 'test', tags: [], properties: {}, capabilities: [], firmware: firmware() });

test('every catalogue key names a real part and every capability pin exists', () => {
  assert.deepEqual(validateDeviceCatalogue(DEVICES, PARTS), []);
  assert.equal(deviceByPart('esp32'), DEVICES.esp32);
  assert.equal(deviceByPart('missing'), undefined);
  assert.deepEqual(Object.keys(DEVICES).sort(), Object.keys(PARTS).sort());
});

test('duplicate I2C role pins and inverted numeric ranges are rejected', () => {
  const a = row('mpu6050');
  a.capabilities.push({ kind: 'i2c', sda: 'SDA', scl: 'SDA' });
  const b = row('speaker');
  b.properties.volume = { kind: 'number', default: 1, min: 2, max: 1 };
  const errors = validateDeviceCatalogue({ mpu6050: a, speaker: b }, PARTS);
  assert.ok(errors.some((e) => e.includes('mpu6050: capabilities[0]') && e.includes('duplicate')));
  assert.ok(errors.some((e) => e.includes('speaker: properties.volume') && e.includes('min')));
});

test('property defaults must satisfy their own schema', () => {
  const a = row('speaker');
  a.properties.level = { kind: 'number', default: 5, min: 0, max: 2 };
  a.properties.mode = { kind: 'enum', default: 'bad', values: ['good'] };
  const errors = validateDeviceCatalogue({ speaker: a }, PARTS);
  assert.ok(errors.some((e) => e.includes('properties.level.default')));
  assert.ok(errors.some((e) => e.includes('properties.mode.default')));
});

test('firmware contracts always contain all five stable fields', () => {
  const a = row('speaker');
  delete a.firmware.actions;
  assert.ok(validateDeviceCatalogue({ speaker: a }, PARTS).some((e) => e.includes('firmware.actions')));
});

test('malformed fixtures return errors without throwing', () => {
  assert.ok(validateDeviceCatalogue({ bad: null, other: { capabilities: [null] } }, {}).length);
  assert.ok(validateDeviceCatalogue(null, null).length);
});

test('rejects extra device fields and sparse arrays', () => {
  const a = row('speaker');
  a.extra = true;
  a.tags = Array(1);
  a.capabilities = Array(1);
  a.firmware.actions = Array(1);
  const errors = validateDeviceCatalogue({ speaker: a }, PARTS);
  assert.ok(errors.some((e) => e.includes('extra')));
  assert.ok(errors.some((e) => e.includes('tags')));
  assert.ok(errors.some((e) => e.includes('capabilities')));
  assert.ok(errors.some((e) => e.includes('firmware.actions')));
});

test('malformed pin values are reported without coercion', () => {
  const a = row('speaker');
  a.capabilities = [{ kind: 'source', pin: Object.create(null) }];
  assert.ok(validateDeviceCatalogue({ speaker: a }, PARTS).some((e) => e.includes('unknown pin')));
});

test('lookups do not accept inherited names', () => {
  assert.equal(deviceByPart('toString'), undefined);
  const a = row('toString');
  assert.ok(validateDeviceCatalogue({ toString: a }, {}).some((e) => e.includes('unknown part')));
});

test('sparse arrays are not accepted as objects', () => {
  assert.ok(validateDeviceCatalogue(Array(1), PARTS).length);
  const a = row('speaker');
  a.properties = Array(1);
  a.firmware.init = Array(1);
  const errors = validateDeviceCatalogue({ speaker: a }, PARTS);
  assert.ok(errors.some((e) => e.includes('properties')));
  assert.ok(errors.some((e) => e.includes('firmware.init')));
});

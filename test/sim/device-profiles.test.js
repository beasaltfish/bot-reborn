import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart } from '../../sim/bench.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROFILES, profileById, checkResources } from '../../sim/devices/profiles.js';

const profile = PROFILES[0];
/** @param {import('../../sim/bench.js').Bench} b @param {string} a @param {string} c */
function wire(b, a, c) { b.wires.push({ id: `w${b.wires.length}`, a, b: c, color: 'red' }); }

test('firmware profile records board pin assignments', () => {
  assert.equal(PROFILES[0], profile);
  assert.equal(profileById('missing'), undefined);
  assert.deepEqual(profile.endpoints.audio, { bclk: 'GPIO12', ws: 'GPIO13', dout: 'GPIO14', din: 'GPIO15' });
  assert.deepEqual(profile.endpoints.screen, { sck: 'GPIO11', mosi: 'GPIO10', cs: 'GPIO9', dc: 'GPIO8', rst: 'GPIO18', miso: 'GPIO17' });
  assert.deepEqual(profile.endpoints.wand, { sda: 'GPIO1', scl: 'GPIO2', address: 0x68 });
  assert.deepEqual(profile.endpoints.toy, { driveA: 'GPIO4', driveB: 'GPIO5', steerA: 'GPIO6', steerB: 'GPIO7' });
});

test('passive resistor and independent supply do not claim unsupported firmware', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['resistor', 'dc-source', 'bme280-i2c'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  const issues = checkResources(bench, profile, DEVICES).filter(issue => issue.code === 'firmware-unsupported');
  assert.deepEqual(issues.map(issue => issue.instances), [['env']]);
});

test('same I2C address conflicts only on the same wired bus', () => {
  let b = emptyBench();
  ({ bench: b } = addPart(b, 'mpu6050', { x: 0, z: 0 }));
  ({ bench: b } = addPart(b, 'mpu6050', { x: 0, z: 0 }));
  const devices = { ...DEVICES, mpu6050: { ...DEVICES.mpu6050, firmware: { ...DEVICES.mpu6050.firmware, resources: [{ kind: 'i2c', addressProperty: 'address' }] } } };
  const imu = b.placed.find(p => p.id === 'imu');
  const imu2 = b.placed.find(p => p.id === 'imu2');
  assert.ok(imu && imu2);
  imu.properties.address = '0x68';
  imu2.properties.address = 104;
  assert.deepEqual(checkResources(b, profile, devices), []);
  for (const id of ['imu', 'imu2']) { wire(b, `${id}:SDA`, 'esp:GPIO1'); wire(b, `${id}:SCL`, 'esp:GPIO2'); }
  const issues = checkResources(b, profile, devices);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'i2c-address-conflict');
  assert.deepEqual(issues[0].instances, ['imu', 'imu2']);
  assert.equal(issues[0].detail.address, 0x68);
});

test('BME280 resource address follows grounded SDO and does not guess unknown wiring', () => {
  let b = emptyBench();
  ({ bench: b } = addPart(b, 'bme280-i2c', { x: 0, z: 30 }));
  ({ bench: b } = addPart(b, 'bme280-i2c', { x: 10, z: 30 }));
  for (const id of ['env', 'env2']) { wire(b, `${id}:SDI`, 'esp:GPIO1'); wire(b, `${id}:SCK`, 'esp:GPIO2'); }
  assert.ok(checkResources(b, profile, DEVICES).some(issue => issue.code === 'i2c-address-conflict'));
  wire(b, 'env2:SDO', 'env2:GND');
  assert.ok(!checkResources(b, profile, DEVICES).some(issue => issue.code === 'i2c-address-conflict'));
  wire(b, 'env2:SDO', 'esp:GPIO4');
  assert.ok(!checkResources(b, profile, DEVICES).some(issue => issue.code === 'i2c-address-conflict'));
});

test('unsupported part reports firmware support without invented electrical conflicts', () => {
  const b = emptyBench();
  const limited = { ...profile, supportedParts: profile.supportedParts.filter(p => p !== 'speaker') };
  assert.deepEqual(checkResources(b, limited, DEVICES).map(i => [i.code, i.instances]), [['firmware-unsupported', ['spk']]]);
});

test('firmware wand address is checked without an explicit catalogue resource', () => {
  let b = emptyBench();
  ({ bench: b } = addPart(b, 'mpu6050', { x: 0, z: 0 }));
  ({ bench: b } = addPart(b, 'mpu6050', { x: 0, z: 0 }));
  for (const id of ['imu', 'imu2']) { wire(b, `${id}:SDA`, 'esp:GPIO1'); wire(b, `${id}:SCL`, 'esp:GPIO2'); }
  assert.equal(checkResources(b, profile, DEVICES)[0]?.code, 'i2c-address-conflict');
});

test('SPI chip selects conflict only when both bus and select nets match', () => {
  let b = emptyBench();
  const part = Object.keys(DEVICES).find(k => k.startsWith('screen-') && DEVICES[k].capabilities.some(c => c.kind === 'spi' && c.cs));
  assert.ok(part);
  ({ bench: b } = addPart(b, /** @type {`screen-${string}`} */ (part), { x: 0, z: 0 }));
  ({ bench: b } = addPart(b, /** @type {`screen-${string}`} */ (part), { x: 0, z: 0 }));
  const screens = b.placed.filter(p => p.part === part);
  const cap = DEVICES[part].capabilities.find(c => c.kind === 'spi');
  assert.ok(cap && cap.kind === 'spi' && cap.cs);
  for (const p of screens) { wire(b, `${p.id}:${cap.sck}`, 'esp:GPIO11'); wire(b, `${p.id}:${cap.mosi}`, 'esp:GPIO10'); }
  assert.deepEqual(checkResources(b, profile, DEVICES), []);
  for (const p of screens) wire(b, `${p.id}:${cap.cs}`, 'esp:GPIO9');
  assert.equal(checkResources(b, profile, DEVICES)[0]?.code, 'spi-chip-select-conflict');
});

test('exclusive pin resources conflict while input-only sharing is allowed', () => {
  let b = emptyBench();
  ({ bench: b } = addPart(b, 'toy', { x: 0, z: 0 }));
  ({ bench: b } = addPart(b, 'toy', { x: 0, z: 0 }));
  wire(b, 'toy:U3A', 'toy2:U3A');
  assert.deepEqual(checkResources(b, profile, DEVICES), []);
  const devices = { ...DEVICES, toy: { ...DEVICES.toy, capabilities: /** @type {import('../../sim/devices/catalog.js').Capability[]} */ ([{ kind: 'pwm', pin: 'U3A' }]) } };
  assert.equal(checkResources(b, profile, devices)[0]?.code, 'resource-pin-conflict');
});

test('exclusive resource conflicts with a shared bus line', () => {
  let b = emptyBench();
  ({ bench: b } = addPart(b, 'mpu6050', { x: 0, z: 0 }));
  ({ bench: b } = addPart(b, 'toy', { x: 0, z: 0 }));
  wire(b, 'imu:SDA', 'toy:U3A');
  const devices = { ...DEVICES, toy: { ...DEVICES.toy, capabilities: /** @type {import('../../sim/devices/catalog.js').Capability[]} */ ([{ kind: 'pwm', pin: 'U3A' }]) } };
  assert.equal(checkResources(b, profile, devices)[0]?.code, 'resource-pin-conflict');
});

test('distinct exclusive endpoints of one instance conflict when shorted', () => {
  let b = emptyBench();
  ({ bench: b } = addPart(b, 'toy', { x: 0, z: 0 }));
  wire(b, 'toy:U3A', 'toy:U3B');
  const devices = { ...DEVICES, toy: { ...DEVICES.toy, capabilities: /** @type {import('../../sim/devices/catalog.js').Capability[]} */ ([{ kind: 'pwm', pin: 'U3A' }, { kind: 'oneWire', pin: 'U3B' }]) } };
  assert.equal(checkResources(b, profile, devices)[0]?.code, 'resource-pin-conflict');
});

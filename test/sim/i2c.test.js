import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, setPartProperty } from '../../sim/bench.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { evaluateI2c } from '../../sim/electrical/i2c.js';
import { bme280Wiring } from '../../sim/devices/bme280-wiring.js';

/** @param {string} id @param {number} [address] */
const sensor = (id, address = 0x76) => ({ id, sda: 'SDA', scl: 'SCL', address });
const powered = { controllerPowered: true, devices: { imu: { status: 'ok' }, imu2: { status: 'ok' } } };
function bench() { return addPart(emptyBench(), 'mpu6050', { x: 0, z: 30 }).bench; }
/** @param {import('../../sim/bench.js').Bench} b @param {string} a @param {string} c */
function wire(b, a, c) { return addWire(b, a, c, 'yellow'); }
/** @param {import('../../sim/bench.js').Bench} b @param {ReturnType<typeof sensor>[]} instances @param {{controllerPowered:boolean,devices:Record<string,{status:string}>}} [electrical] */
function evaluate(b, instances, electrical = powered) { return evaluateI2c(b, PROFILES[0], instances, electrical); }

test('I2C distinguishes a ready bus, reversed lines, shorts, and wrong bus', () => {
  let b = bench();
  b = wire(wire(b, 'imu:SDA', 'esp:GPIO1'), 'imu:SCL', 'esp:GPIO2');
  assert.equal(evaluate(b, [sensor('imu')]).states.imu, 'ready');
  let swapped = bench();
  swapped = wire(wire(swapped, 'imu:SDA', 'esp:GPIO2'), 'imu:SCL', 'esp:GPIO1');
  assert.equal(evaluate(swapped, [sensor('imu')]).states.imu, 'swapped');
  let shorted = wire(bench(), 'imu:SDA', 'imu:SCL');
  assert.equal(evaluate(shorted, [sensor('imu')]).states.imu, 'shorted');
  let wrong = wire(wire(bench(), 'imu:SDA', 'esp:GPIO4'), 'imu:SCL', 'esp:GPIO5');
  assert.equal(evaluate(wrong, [sensor('imu')]).states.imu, 'wrong-bus');
  const rail = evaluate(wire(bench(), 'imu:SDA', 'esp:3V3'), [sensor('imu')]);
  assert.equal(rail.states.imu, 'shorted');
  assert.deepEqual(rail.faults[0].points, ['esp:3V3', 'imu:SCL', 'imu:SDA']);
  assert.equal(evaluate(b, [sensor('imu')], { controllerPowered: true, devices: { imu: { status: 'unpowered' } } }).states.imu, 'off');
});

test('a sensor is not ready when the controller is unpowered or its state is unknown', () => {
  let b = bench();
  b = wire(wire(b, 'imu:SDA', 'esp:GPIO1'), 'imu:SCL', 'esp:GPIO2');
  const result = evaluate(b, [sensor('imu')], { controllerPowered: false, devices: { imu: { status: 'ok' } } });
  assert.equal(result.states.imu, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'i2c-controller-unpowered'));
  const unknown = evaluateI2c(b, PROFILES[0], [sensor('imu')], /** @type {any} */ ({ devices: { imu: { status: 'ok' } } }));
  assert.notEqual(unknown.states.imu, 'ready');
});

test('invalid sensor supplies are not described as simply unpowered', () => {
  let b = bench();
  b = wire(wire(b, 'imu:SDA', 'esp:GPIO1'), 'imu:SCL', 'esp:GPIO2');
  const result = evaluate(b, [sensor('imu')], { controllerPowered: true, devices: { imu: { status: 'overvoltage' } } });
  assert.equal(result.states.imu, 'unsupported-voltage');
  assert.ok(result.faults.some(fault => fault.code === 'i2c-supply-invalid'));
  assert.ok(!result.faults.some(fault => fault.code === 'i2c-unpowered'));
});

test('three BME280 devices at one address report a single complete conflict group', () => {
  let b = emptyBench();
  for (let i = 0; i < 3; i++) b = addPart(b, 'bme280-i2c', { x: i * 10, z: 30 }).bench;
  for (const id of ['env', 'env2', 'env3']) {
    b = wire(wire(b, `${id}:SDI`, 'esp:GPIO1'), `${id}:SCK`, 'esp:GPIO2');
  }
  const items = ['env', 'env2', 'env3'].map(id => ({ id, sda: 'SDI', scl: 'SCK', address: 0x77 }));
  const electrical = { controllerPowered: true, devices: Object.fromEntries(items.map(item => [item.id, { status: 'ok' }])) };
  const result = evaluateI2c(b, PROFILES[0], items, electrical);
  const conflicts = result.faults.filter(f => f.code === 'i2c-address-conflict');
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].instances, ['env', 'env2', 'env3']);
  assert.equal(conflicts[0].points.length, 6);
  b = setPartProperty(b, 'env3', 'address', '0x76');
  items[2].address = Number(b.placed.find(part => part.id === 'env3')?.properties.address);
  const changed = evaluateI2c(b, PROFILES[0], items, electrical);
  assert.equal(changed.states.env3, 'ready');
  assert.deepEqual(changed.faults.find(f => f.code === 'i2c-address-conflict')?.instances, ['env', 'env2']);
});

test('grounding the second BME280 SDO separates addresses on a shared bus', () => {
  let b = emptyBench();
  for (let i = 0; i < 2; i++) b = addPart(b, 'bme280-i2c', { x: i * 10, z: 30 }).bench;
  for (const id of ['env', 'env2']) b = wire(wire(b, `${id}:SDI`, 'esp:GPIO1'), `${id}:SCK`, 'esp:GPIO2');
  b = wire(b, 'env2:SDO', 'env2:GND');
  const items = ['env', 'env2'].map(id => {
    const wiring = bme280Wiring(b, id);
    assert.ok(wiring.supported && wiring.address !== null);
    return { id, sda: 'SDI', scl: 'SCK', address: wiring.address };
  });
  const result = evaluateI2c(b, PROFILES[0], items, { controllerPowered: true, devices: { env: { status: 'ok' }, env2: { status: 'ok' } } });
  assert.deepEqual(result.states, { env: 'ready', env2: 'ready' });
  assert.ok(!result.faults.some(fault => fault.code === 'i2c-address-conflict'));
});

test('address collisions identify both devices while distinct addresses share the bus', () => {
  let b = addPart(bench(), 'mpu6050', { x: 10, z: 30 }).bench;
  for (const [a, c] of [['imu:SDA', 'esp:GPIO1'], ['imu:SCL', 'esp:GPIO2'], ['imu2:SDA', 'esp:GPIO1'], ['imu2:SCL', 'esp:GPIO2']]) b = wire(b, a, c);
  const conflict = evaluate(b, [sensor('imu'), sensor('imu2')]);
  assert.equal(conflict.states.imu, 'address-conflict');
  assert.equal(conflict.states.imu2, 'address-conflict');
  assert.deepEqual(conflict.faults.find(f => f.code === 'i2c-address-conflict')?.instances, ['imu', 'imu2']);
  const shared = evaluate(b, [sensor('imu'), sensor('imu2', 0x77)]);
  assert.equal(shared.states.imu, 'ready');
  assert.equal(shared.states.imu2, 'ready');
});

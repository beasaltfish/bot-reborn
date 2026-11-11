import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { evaluateI2c } from '../../sim/electrical/i2c.js';

/** @param {string} id @param {number} [address] */
const sensor = (id, address = 0x76) => ({ id, sda: 'SDA', scl: 'SCL', address });
const powered = { devices: { imu: { status: 'ok' }, imu2: { status: 'ok' } } };
function bench() { return addPart(emptyBench(), 'mpu6050', { x: 0, z: 30 }).bench; }
/** @param {import('../../sim/bench.js').Bench} b @param {string} a @param {string} c */
function wire(b, a, c) { return addWire(b, a, c, 'yellow'); }
/** @param {import('../../sim/bench.js').Bench} b @param {ReturnType<typeof sensor>[]} instances @param {{devices:Record<string,{status:string}>}} [electrical] */
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
  assert.equal(evaluate(b, [sensor('imu')], { devices: { imu: { status: 'unpowered' } } }).states.imu, 'off');
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

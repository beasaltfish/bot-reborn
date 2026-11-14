import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';

/** @param {boolean} [usb] */
function fixture(usb = true) {
  let b = { ...addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 30 }).bench, usb };
  for (const [a, c] of [['env:VIN', 'esp:3V3'], ['env:GND', 'esp:GND'], ['env:SDI', 'esp:GPIO1'], ['env:SCK', 'esp:GPIO2']]) b = addWire(b, a, c, 'yellow');
  return b;
}

test('powered supported BME280 topology gives bounded simulated readings without claiming firmware support', () => {
  const bench = fixture();
  const result = evaluateBench(bench, { stimuli: { temperatureC: 200, humidityPct: 45, pressureHpa: NaN } });
  const sensor = result.engineering.bme280.env;
  assert.equal(sensor.state, 'ready');
  assert.deepEqual(sensor.telemetry, { temperatureC: 85, humidityPct: 45, pressureHpa: 1013.25 });
  assert.ok(result.faults.some(fault => fault.code === 'firmware-unsupported' && 'instances' in fault && fault.instances.includes('env')));
  const placed = bench.placed.find(part => part.id === 'env');
  assert.ok(placed);
  assert.ok(!('temperatureC' in placed.properties));
});

test('no readings appear with USB out, swapped lines, invalid SDO, or a board power conflict', () => {
  let bench = fixture(false);
  assert.equal(evaluateBench(bench).engineering.bme280.env.telemetry, null);
  bench = { ...fixture(), wires: fixture().wires.filter(wire => !wire.a.startsWith('env:SDI') && !wire.a.startsWith('env:SCK')) };
  bench = addWire(addWire(bench, 'env:SDI', 'esp:GPIO2', 'yellow'), 'env:SCK', 'esp:GPIO1', 'yellow');
  assert.equal(evaluateBench(bench).engineering.bme280.env.state, 'swapped');
  assert.equal(evaluateBench(bench).engineering.bme280.env.telemetry, null);
  const unknown = addWire(fixture(), 'env:SDO', 'esp:GPIO4', 'yellow');
  assert.equal(evaluateBench(unknown).engineering.bme280.env.telemetry, null);
  assert.ok(evaluateBench(unknown).faults.some(fault => fault.code === 'unsupported-electrical-network' && fault.points.includes('env:SDO')));
  const short = addWire(fixture(), 'esp:5V', 'esp:GND', 'black');
  assert.equal(evaluateBench(short).engineering.bme280.env.telemetry, null);
});

test('two powered BME280s conflict at one address and both work after grounding SDO', () => {
  let bench = addPart(fixture(), 'bme280-i2c', { x: 10, z: 30 }).bench;
  for (const [a, b] of [['env2:VIN', 'esp:3V3'], ['env2:GND', 'esp:GND'], ['env2:SDI', 'esp:GPIO1'], ['env2:SCK', 'esp:GPIO2']]) bench = addWire(bench, a, b, 'yellow');
  const conflict = evaluateBench(bench);
  assert.equal(conflict.engineering.bme280.env.state, 'address-conflict');
  assert.equal(conflict.engineering.bme280.env2.telemetry, null);
  bench = addWire(bench, 'env2:SDO', 'env2:GND', 'black');
  const separated = evaluateBench(bench);
  assert.equal(separated.engineering.bme280.env.state, 'ready');
  assert.equal(separated.engineering.bme280.env2.state, 'ready');
  assert.ok(!separated.faults.some(fault => fault.code === 'i2c-address-conflict'));
});

test('a swapped BME280 sharing the bus prevents confident readings from its peer', () => {
  let bench = addPart(fixture(), 'bme280-i2c', { x: 10, z: 30 }).bench;
  for (const [a, b] of [['env2:VIN', 'esp:3V3'], ['env2:GND', 'esp:GND'], ['env2:SDI', 'esp:GPIO2'], ['env2:SCK', 'esp:GPIO1']]) bench = addWire(bench, a, b, 'yellow');
  const result = evaluateBench(bench);
  assert.equal(result.engineering.bme280.env2.state, 'swapped');
  assert.equal(result.engineering.bme280.env.telemetry, null);
});

test('unknown other loads on I2C do not produce invented sensor readings', () => {
  let bench = addPart(fixture(), 'resistor', { x: 0, z: 40 }).bench;
  bench = addWire(bench, 'r:1', 'env:SDI', 'yellow');
  const result = evaluateBench(bench);
  assert.equal(result.engineering.bme280.env.telemetry, null);
  assert.ok(result.faults.some(fault => fault.code === 'unsupported-electrical-network' && fault.points.includes('r:1')));
});

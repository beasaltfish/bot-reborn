import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, setPartProperty } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { blockingBoardPowerFault } from '../../sim/board-power-gate.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { createPowerInterlock } from '../../sim/power-interlock.js';

function sensor() { return addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 30 }).bench; }
/** @param {import('../../sim/bench.js').Bench} b @param {string} a @param {string} c */
const wire = (b, a, c) => addWire(b, a, c, 'yellow');

test('powered 5 V BME280 pull-ups reaching an ESP32 GPIO trigger the board safety gate', () => {
  let b = { ...sensor(), usb: true };
  b = wire(wire(b, 'env:VIN', 'esp:5V'), 'env:SDI', 'esp:GPIO1');
  const result = evaluateBench(b);
  const fault = result.faults.find(f => f.code === 'i2c-level-incompatible');
  assert.ok(fault);
  assert.ok(fault.points.includes('env:VIN') && fault.points.includes('env:SDI') && fault.points.includes('esp:GPIO1'));
  assert.equal(blockingBoardPowerFault(b, result)?.code, 'i2c-level-incompatible');
});

test('board 3.3 V supply or an unconnected bus does not trigger a 5 V pull-up warning', () => {
  let b = { ...sensor(), usb: true };
  b = wire(wire(b, 'env:VIN', 'esp:3V3'), 'env:SCK', 'esp:GPIO2');
  assert.ok(!evaluateBench(b).faults.some(f => f.code === 'i2c-level-incompatible'));
  let isolated = { ...sensor(), usb: true };
  isolated = wire(isolated, 'env:VIN', 'esp:5V');
  assert.ok(!evaluateBench(isolated).faults.some(f => f.code === 'i2c-level-incompatible'));
});

test('resistor between ESP32 5 V and BME280 VIN is unsupported when the bus reaches GPIO', () => {
  let b = addPart({ ...sensor(), usb: true }, 'resistor', { x: 0, z: 0 }).bench;
  b = wire(wire(wire(b, 'esp:5V', 'r:1'), 'r:2', 'env:VIN'), 'env:SDI', 'esp:GPIO1');
  const result = evaluateBench(b);
  const fault = result.faults.find(f => f.code === 'unsupported-electrical-network' && 'instances' in f && f.instances.includes('env'));
  assert.ok(fault);
  for (const point of ['esp:5V', 'r:1', 'r:2', 'env:VIN', 'env:SDI', 'esp:GPIO1']) assert.ok(fault.points.includes(point), point);
  assert.ok(blockingBoardPowerFault(b, result));
});

test('a burnt resistor does not erase an unknown BME280 pull-up path', () => {
  let b = addPart({ ...sensor(), usb: true }, 'resistor', { x: 0, z: 0 }).bench;
  b = { ...b, placed: b.placed.map(part => part.id === 'r' ? { ...part, burnt: true } : part) };
  b = wire(wire(wire(b, 'esp:5V', 'r:1'), 'r:2', 'env:VIN'), 'env:SDI', 'esp:GPIO1');
  const result = evaluateBench(b);
  const fault = result.faults.find(f => f.code === 'unsupported-electrical-network' && 'instances' in f && f.instances.includes('env'));
  assert.ok(fault);
  assert.ok(fault.points.includes('r:1') && fault.points.includes('r:2'));
  assert.ok(blockingBoardPowerFault(b, result));
});

test('resistor between BME280 signal and GPIO is unsupported with a 5 V supply', () => {
  let b = addPart({ ...sensor(), usb: true }, 'resistor', { x: 0, z: 0 }).bench;
  b = wire(wire(wire(b, 'esp:5V', 'env:VIN'), 'env:SCK', 'r:1'), 'r:2', 'esp:GPIO2');
  const result = evaluateBench(b);
  const fault = result.faults.find(f => f.code === 'unsupported-electrical-network' && 'instances' in f && f.instances.includes('env'));
  assert.ok(fault);
  for (const point of ['env:SCK', 'r:1', 'r:2', 'esp:GPIO2']) assert.ok(fault.points.includes(point), point);
  assert.ok(blockingBoardPowerFault(b, result));
});

test('an external source path through two resistors and a breadboard trips when completed', () => {
  let b = addPart({ ...sensor(), usb: true }, 'dc-source', { x: 0, z: 0 }).bench;
  b = addPart(addPart(b, 'resistor', { x: 0, z: 0 }).bench, 'resistor', { x: 0, z: 0 }).bench;
  for (const [a, c] of [['src:-', 'esp:GND'], ['src:+', 'r:1'], ['r:2', 'bb1:a1'], ['r2:1', 'bb1:b1'], ['r2:2', 'env:VIN']]) b = wire(b, a, c);
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(b, evaluateBench(b));
  b = wire(b, 'env:SDI', 'esp:GPIO1');
  const fault = interlock.observe(b, evaluateBench(b));
  assert.equal(fault?.code, 'unsupported-electrical-network');
  for (const point of ['r:1', 'r:2', 'r2:1', 'r2:2', 'env:VIN']) assert.ok(fault?.points.includes(point), point);
  assert.equal(stops, 1);
  assert.equal(interlock.tripped(), true);
});

test('unknown GPIO voltage cannot make a 5 V BME pull-up look safe', () => {
  let b = { ...sensor(), usb: true };
  b = wire(wire(b, 'env:VIN', 'esp:5V'), 'env:SDI', 'esp:GPIO1');
  const result = evaluateBench(b, { profile: { ...PROFILES[0], gpioVoltage: NaN } });
  assert.ok(result.faults.some(f => f.code === 'unsupported-electrical-network' && 'instances' in f && f.instances.includes('env')));
  assert.ok(blockingBoardPowerFault(b, result));
});

test('a safe 3.3 V BME source and an unrelated floating supply do not trip on a pull-down', () => {
  let b = addPart({ ...sensor(), usb: true }, 'resistor', { x: 0, z: 0 }).bench;
  b = addPart(b, 'dc-source', { x: 0, z: 0 }).bench;
  for (const [a, c] of [['esp:3V3', 'env:VIN'], ['env:SDI', 'esp:GPIO1'], ['esp:3V3', 'r:1'], ['r:2', 'esp:GND'], ['src:-', 'esp:GND']]) b = wire(b, a, c);
  const result = evaluateBench(b);
  assert.ok(!result.faults.some(f => f.code === 'unsupported-electrical-network' && 'instances' in f && f.instances.includes('env')));
  assert.equal(blockingBoardPowerFault(b, result), null);
});

test('an independent high-voltage supply feeding BME280 pull-ups is conservatively reported', () => {
  let b = addPart(sensor(), 'dc-source', { x: 0, z: 0 }).bench;
  b = wire(wire(wire(b, 'src:+', 'env:VIN'), 'src:-', 'esp:GND'), 'env:SCK', 'esp:GPIO4');
  const result = evaluateBench(b);
  assert.ok(result.faults.some(f => f.code === 'i2c-level-incompatible' && f.points.includes('esp:GPIO4')));
  b = setPartProperty(b, 'src', 'voltage', 3.3);
  assert.ok(!evaluateBench(b).faults.some(f => f.code === 'i2c-level-incompatible'));
  let floating = addPart(sensor(), 'dc-source', { x: 0, z: 0 }).bench;
  floating = wire(wire(floating, 'src:+', 'env:VIN'), 'env:SDI', 'esp:GPIO1');
  const unknown = evaluateBench(floating).faults.find(f => f.code === 'unsupported-electrical-network' && 'instances' in f && f.instances.includes('env'));
  assert.ok(unknown, 'a floating external reference must not be assumed safe');
});

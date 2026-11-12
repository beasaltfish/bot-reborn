import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, removeWire, setPartProperty } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { createPowerInterlock, createStartLock } from '../../sim/power-interlock.js';

test('a new powered board conflict stops once and stays latched until a power cycle', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addWire(bench, 'src:+', 'esp:3V3', 'red');
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  assert.equal(interlock.tripped(), false);
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  const fault = interlock.observe(bench, evaluateBench(bench));
  assert.equal(fault?.code, 'source-contention');
  assert.equal(interlock.tripped(), true);
  assert.equal(stops, 1);
  interlock.observe(bench, evaluateBench(bench));
  assert.equal(stops, 1);
  const wire = bench.wires.at(-1); assert.ok(wire);
  bench = removeWire(bench, wire.id);
  assert.equal(interlock.observe(bench, evaluateBench(bench)), null);
  assert.equal(interlock.tripped(), true, 'repair alone must not restart a body');
  interlock.reset();
  interlock.arm(bench, evaluateBench(bench));
  assert.equal(interlock.tripped(), false);
});

test('a new ESP32 rail short trips but an unrelated independent short does not', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  bench = addWire(bench, 'src:+', 'src:-', 'red');
  assert.equal(interlock.observe(bench, evaluateBench(bench)), null);
  assert.equal(stops, 0);
  bench = addWire(bench, 'esp:3V3', 'esp:GND', 'red');
  assert.equal(interlock.observe(bench, evaluateBench(bench))?.code, 'short-rails');
  assert.equal(stops, 1);
});

test('an unsafe external GPIO voltage trips while a source within nominal logic voltage does not', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  bench = setPartProperty(bench, 'src', 'voltage', 3.3);
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  bench = addWire(bench, 'src:+', 'esp:GPIO4', 'red');
  assert.equal(interlock.observe(bench, evaluateBench(bench)), null);
  bench = setPartProperty(bench, 'src', 'voltage', 5);
  assert.equal(interlock.observe(bench, evaluateBench(bench))?.code, 'gpio-overvoltage-risk');
  assert.equal(stops, 1);
});

test('a newly closed resistor path from source to GPIO trips as unsupported', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  bench = addWire(bench, 'r:2', 'esp:GPIO4', 'yellow');
  assert.equal(interlock.observe(bench, evaluateBench(bench))?.code, 'unsupported-electrical-network');
  assert.equal(stops, 1);
});

test('a newly connected 5 V BME280 pull-up stops and latches the powered session', () => {
  let bench = { ...addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 0 }).bench, usb: true };
  bench = addWire(bench, 'env:VIN', 'esp:5V', 'red');
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  bench = addWire(bench, 'env:SDI', 'esp:GPIO1', 'yellow');
  assert.equal(interlock.observe(bench, evaluateBench(bench))?.code, 'i2c-level-incompatible');
  assert.equal(interlock.tripped(), true);
  assert.equal(stops, 1);
});

test('an initially blocked plug stays latched without stopping twice', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addWire(bench, 'src:+', 'esp:5V', 'red'); bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  assert.equal(interlock.tripped(), true);
  interlock.observe(bench, evaluateBench(bench));
  assert.equal(stops, 0);
});

test('an older asynchronous start cannot unlock a newer start after cancellation', () => {
  const lock = createStartLock();
  lock.begin(1); assert.equal(lock.locked(), true);
  lock.clear(); lock.begin(2); lock.release(1);
  assert.equal(lock.locked(), true);
  lock.release(2); assert.equal(lock.locked(), false);
});

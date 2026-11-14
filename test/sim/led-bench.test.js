import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, place } from '../../sim/bench.js';
import { applyLedDamage, evaluateLedBench } from '../../sim/electrical/led-bench.js';

test('LED follows the connected series resistor and power supply', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'led:A', 'yellow');
  bench = addWire(bench, 'led:K', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'on');
  assert.ok(Math.abs(evaluateLedBench(bench, 'led').currentMa - 3000 / 220.2) < 0.001);
  bench = addWire(bench, 'esp:3V3', 'src:+', 'red');
  assert.equal(evaluateLedBench(bench, 'led').state, 'unsupported');
});

test('overcurrent damages the LED persistently while a limited supply does not', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'led:A', 'red');
  bench = addWire(bench, 'led:K', 'src:-', 'black');
  const damaged = applyLedDamage(bench);
  assert.deepEqual(damaged.burns, ['led']);
  assert.equal(evaluateLedBench(damaged.bench, 'led').state, 'burnt');
  assert.deepEqual(applyLedDamage(damaged.bench).burns, []);
  const limited = { ...bench, placed: bench.placed.map(p => p.id === 'src' ? { ...p, properties: { ...p.properties, currentLimitMa: 10 } } : p) };
  assert.deepEqual(applyLedDamage(limited).burns, []);
});

test('reversing the LED or disconnecting the supply leaves it off', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'led:K', 'yellow');
  bench = addWire(bench, 'led:A', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'reversed');
});

test('a shorted supply is reported separately from reversed polarity', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'led:A', 'red');
  bench = addWire(bench, 'led:K', 'src:-', 'black');
  bench = addWire(bench, 'src:+', 'src:-', 'yellow');
  assert.equal(evaluateLedBench(bench, 'led').state, 'short');
  assert.deepEqual(applyLedDamage(bench).burns, []);
});

test('breadboard strips connect a resistor and LED exactly like wires', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = place(bench, 'r', { x: -21, z: -6 }, 0, true);
  bench = place(bench, 'led', { x: -17, z: -5 }, 0, true);
  bench = addWire(bench, 'src:+', 'bb1:c11', 'red');
  bench = addWire(bench, 'src:-', 'bb1:c16', 'black');
  const outcome = evaluateLedBench(bench, 'led');
  assert.equal(outcome.state, 'on');
  assert.ok(Math.abs(outcome.currentMa - 3000 / 220.2) < 0.001);
});

test('a closed LED loop with two series resistors is unsupported, not off or working', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'r2:1', 'yellow');
  bench = addWire(bench, 'r2:2', 'led:A', 'yellow');
  bench = addWire(bench, 'led:K', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'unsupported');
  assert.deepEqual(applyLedDamage(bench).burns, []);
});

test('a closed loop with two series sources is unsupported', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'dc-source', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'led:A', 'yellow');
  bench = addWire(bench, 'led:K', 'src2:-', 'black');
  bench = addWire(bench, 'src2:+', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'unsupported');
  assert.deepEqual(applyLedDamage(bench).burns, []);
});

test('an unrelated source does not invalidate a supported LED loop', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'dc-source', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'led:A', 'yellow');
  bench = addWire(bench, 'led:K', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'on');
});

test('two LEDs in series are explicitly unsupported', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'led-5mm', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'led:A', 'yellow');
  bench = addWire(bench, 'led:K', 'led2:A', 'yellow');
  bench = addWire(bench, 'led2:K', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'unsupported');
  assert.equal(evaluateLedBench(bench, 'led2').state, 'unsupported');
  assert.deepEqual(applyLedDamage(bench).burns, []);
});

test('an open LED circuit with two resistors remains off', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'r2:1', 'yellow');
  bench = addWire(bench, 'r2:2', 'led:A', 'yellow');
  assert.equal(evaluateLedBench(bench, 'led').state, 'off');
});

test('the resistor can be on the cathode side of the LED', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'led:A', 'red');
  bench = addWire(bench, 'led:K', 'r:1', 'yellow');
  bench = addWire(bench, 'r:2', 'src:-', 'black');
  assert.equal(evaluateLedBench(bench, 'led').state, 'on');
});

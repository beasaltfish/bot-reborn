import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench } from '../../sim/bench.js';
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
  assert.equal(evaluateLedBench(bench, 'led').state, 'off');
});

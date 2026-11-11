import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, load, serialize, setPartProperty } from '../../sim/bench.js';
import { nets } from '../../sim/netlist.js';
import { evaluateLedBench } from '../../sim/electrical/led-bench.js';

test('a push button closes only while pressed and survives a save', () => {
  let bench = addPart(emptyBench(), 'push-button', { x: 0, z: 0 }).bench;
  assert.equal(nets(bench).same('button:1', 'button:2'), false);
  bench = setPartProperty(bench, 'button', 'pressed', true);
  assert.equal(nets(bench).same('button:1', 'button:2'), true);
  assert.equal(nets(load(serialize(bench))).same('button:1', 'button:2'), true);
  bench = setPartProperty(bench, 'button', 'pressed', false);
  assert.equal(nets(bench).same('button:1', 'button:2'), false);
});

test('a button in series switches a resistor-limited LED', () => {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['push-button', 'led-5mm', 'resistor', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  for (const [a, b] of [['src:+', 'button:1'], ['button:2', 'r:1'], ['r:2', 'led:A'], ['led:K', 'src:-']]) bench = addWire(bench, a, b, 'red');
  assert.equal(evaluateLedBench(bench, 'led').state, 'off');
  bench = setPartProperty(bench, 'button', 'pressed', true);
  assert.equal(evaluateLedBench(bench, 'led').state, 'on');
  bench = setPartProperty(bench, 'button', 'pressed', false);
  assert.equal(evaluateLedBench(bench, 'led').state, 'off');
});

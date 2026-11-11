import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, emptyBench, load, serialize, setPartProperty } from '../../sim/bench.js';
import { nets } from '../../sim/netlist.js';

test('a push button closes only while pressed and survives a save', () => {
  let bench = addPart(emptyBench(), 'push-button', { x: 0, z: 0 }).bench;
  assert.equal(nets(bench).same('button:1', 'button:2'), false);
  bench = setPartProperty(bench, 'button', 'pressed', true);
  assert.equal(nets(bench).same('button:1', 'button:2'), true);
  assert.equal(nets(load(serialize(bench))).same('button:1', 'button:2'), true);
  bench = setPartProperty(bench, 'button', 'pressed', false);
  assert.equal(nets(bench).same('button:1', 'button:2'), false);
});

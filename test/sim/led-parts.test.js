import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS } from '../../sim/parts.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { addPart, emptyBench, load, serialize, setPartProperty } from '../../sim/bench.js';

test('LED, resistor and adjustable supply have physical pins and persisted properties', () => {
  for (const [id, names] of /** @type {[string, string[]][]} */ ([['led-5mm', ['A', 'K']], ['resistor', ['1', '2']], ['dc-source', ['+', '-']]])) {
    assert.deepEqual(PARTS[id].pins.map(pin => pin.name), names);
    assert.ok(DEVICES[id]);
  }
  let bench = addPart(emptyBench(), 'resistor', { x: 5, z: 5 }).bench;
  bench = setPartProperty(bench, 'r', 'ohms', 1000);
  assert.equal(load(serialize(bench)).placed.find(part => part.id === 'r')?.properties.ohms, 1000);
});

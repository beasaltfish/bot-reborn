import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, propertiesFor } from '../../sim/bench.js';
import { shoppingList, totalUsd } from '../../sim/shopping.js';
import { planById } from '../../sim/plan.js';

test('the audio + screen recipe produces a complete, merged list', () => {
  const plan = planById('screen');
  assert.ok(plan);
  const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
    // The recipes treat the ESP32 as the bench's own board, so the test adds it explicitly.
    { id: 'esp', part: 'esp32', at: { x: 0, z: 0 }, rot: 0, seated: true, burnt: false, properties: propertiesFor('esp32') },
    ...plan.parts.map((p) => ({
      id: p.id, part: p.part, at: p.at, rot: p.rot, seated: p.seated,
      burnt: false, properties: propertiesFor(p.part),
    })),
  ]);
  const boards = emptyBench().boards.concat({ id: 'bb2', x: 0, z: 0, rot: 0 });
  const { lines } = shoppingList({ ...emptyBench(), placed, boards });
  const byKey = new Map(lines.map((l) => [l.key, l]));
  assert.equal(byKey.get('esp32')?.quantity, 1);
  assert.equal(byKey.get('inmp441')?.quantity, 1);
  assert.equal(byKey.get('speaker')?.quantity, 1);
  assert.equal(byKey.get('breadboard')?.quantity, 2);
  assert.equal(byKey.get('jumper-wires')?.quantity, 1);
  assert.equal(byKey.get('usb-cable')?.quantity, 1);
});

test('same part twice is one line with quantity 2, different resistances are two lines', () => {
  const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
    { id: 'led1', part: 'led-5mm', at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false, properties: propertiesFor('led-5mm') },
    { id: 'led2', part: 'led-5mm', at: { x: 1, z: 0 }, rot: 0, seated: false, burnt: false, properties: propertiesFor('led-5mm') },
    { id: 'r1', part: 'resistor', at: { x: 2, z: 0 }, rot: 0, seated: false, burnt: false, properties: { ohms: 220 } },
    { id: 'r2', part: 'resistor', at: { x: 3, z: 0 }, rot: 0, seated: false, burnt: false, properties: { ohms: 1000 } },
  ]);
  const { lines } = shoppingList({ ...emptyBench(), placed });
  assert.equal(lines.find((l) => l.key === 'led-5mm')?.quantity, 2);
  assert.equal(lines.filter((l) => l.key.startsWith('resistor')).length, 2);
  assert.ok(lines.some((l) => l.key === 'resistor|220'));
  assert.ok(lines.some((l) => l.key === 'resistor|1000'));
});

test('an empty bench lists nothing and totals zero', () => {
  const { lines } = shoppingList({ ...emptyBench(), placed: [], boards: [] });
  assert.deepEqual(lines, []);
  assert.deepEqual(totalUsd(lines), { low: 0, high: 0 });
});

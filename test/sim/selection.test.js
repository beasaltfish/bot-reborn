import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, removeWire, trash } from '../../sim/bench.js';
import { normalizeSelection, describeSelection, createSelection } from '../../sim/selection.js';

test('selection distinguishes instances and repeated pin names', () => {
  const { bench, id } = addPart(emptyBench(), 'inmp441', { x: 0, z: 0 });
  assert.equal(id, 'mic2');
  assert.deepEqual(normalizeSelection(bench, { kind: 'part', id }), { kind: 'part', id: 'mic2' });
  assert.deepEqual(describeSelection(bench, { kind: 'pin', point: 'mic2:GND' }, 'en')?.points, ['mic2:GND']);
  assert.equal(normalizeSelection(bench, { kind: 'pin', point: 'mic2:GND.2' }), null);
  assert.deepEqual(describeSelection(bench, { kind: 'pin', point: 'esp:GND.2' }, 'en')?.points, ['esp:GND.2']);
});

test('descriptions expose localized names, declared pin roles and actionable wire details', () => {
  const added = addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 0 });
  const pin = describeSelection(added.bench, { kind: 'pin', point: `${added.id}:SDI` }, 'zh');
  assert.ok(pin);
  assert.match(pin.title, /SDI/);
  assert.ok(pin.rows.some(row => row.value === 'I2C SDA'));
  assert.ok(pin.actions.some(action => action.id === 'start-wire'));
  const part = describeSelection(added.bench, { kind: 'part', id: added.id }, 'zh');
  assert.ok(part);
  assert.match(part.title, /环境传感器/);
  const b = addWire(added.bench, 'esp:3V3', `${added.id}:VIN`, 'red');
  const wire = describeSelection(b, { kind: 'wire', id: b.wires[0].id }, 'en');
  assert.ok(wire);
  assert.ok(wire.rows.some(row => row.value === 'red'));
  assert.ok(wire.rows.some(row => row.value === 'esp:3V3'));
  assert.ok(wire.actions.some(action => action.id === 'remove-wire'));
});

test('selection controller emits changes and clears removed targets on refresh', () => {
  let bench = emptyBench();
  /** @type {import('../../sim/selection.js').Selection[]} */
  const changes = [];
  const selection = createSelection(() => bench, value => changes.push(value));
  selection.select({ kind: 'pin', point: 'mic:GND' });
  assert.deepEqual(selection.selection(), { kind: 'pin', point: 'mic:GND' });
  const result = trash(bench, 'mic');
  assert.ok(!('refused' in result));
  bench = result;
  selection.refresh();
  selection.refresh();
  assert.equal(selection.selection(), null);
  assert.deepEqual(changes, [{ kind: 'pin', point: 'mic:GND' }, null]);
});

test('explicitly clearing a selection also works when a reset reuses an instance id', () => {
  let bench = emptyBench();
  const selection = createSelection(() => bench, () => {});
  selection.select({ kind: 'part', id: 'mic' });
  bench = emptyBench();
  selection.select(null);
  selection.refresh();
  assert.equal(selection.selection(), null);
});

test('selection clears when its target disappears', () => {
  let b = addWire(emptyBench(), 'esp:3V3', 'mic:VDD', 'red');
  const wire = b.wires[0];
  assert.deepEqual(describeSelection(b, { kind: 'wire', id: wire.id }, 'en')?.points, ['esp:3V3', 'mic:VDD']);
  b = removeWire(b, wire.id);
  assert.equal(normalizeSelection(b, { kind: 'wire', id: wire.id }), null);
  const trashed = trash(b, 'mic');
  assert.ok(!('refused' in trashed));
  b = trashed;
  assert.equal(normalizeSelection(b, { kind: 'pin', point: 'mic:GND' }), null);
  assert.equal(describeSelection(b, { kind: 'part', id: 'mic' }, 'en'), null);
});

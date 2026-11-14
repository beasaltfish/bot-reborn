import test from 'node:test';
import assert from 'node:assert/strict';
import { queueLabHandoff, consumeLabHandoff, LAB_HANDOFF_KEY } from '../../sim/lab-handoff.js';
import { emptyBench, serialize, load } from '../../sim/bench.js';
import { evaluateLedBench } from '../../sim/electrical/led-bench.js';

/** @param {Record<string,string>} initial */
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (/** @type {string} */ key) => data.get(key) ?? null, setItem: (/** @type {string} */ key, /** @type {string} */ value) => { data.set(key, value); }, removeItem: (/** @type {string} */ key) => { data.delete(key); } };
}

test('add handoff preserves the current bench and is consumed only once', () => {
  const bench = emptyBench();
  const original = serialize(bench);
  const storage = store({ 'botreborn.sim.bench': original });
  assert.equal(queueLabHandoff(storage, { kind: 'add', part: 'led-5mm' }), true);
  assert.equal(storage.getItem('botreborn.sim.bench'), original);
  const result = consumeLabHandoff(storage, bench, () => { throw Error('add must not confirm'); });
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') throw Error('not applied');
  assert.equal(result.bench.placed.filter(part => part.part === 'led-5mm').length, 1);
  assert.equal(result.bench.placed.length, bench.placed.length + 1);
  assert.deepEqual(load(storage.getItem('botreborn.sim.bench')), result.bench);
  assert.equal(consumeLabHandoff(storage, result.bench, () => true).kind, 'none');
});

test('project replacement asks for confirmation, cancellation preserves existing bench', () => {
  const bench = emptyBench();
  const original = serialize(bench);
  const storage = store({ 'botreborn.sim.bench': original });
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'led-basics' }), true);
  assert.equal(consumeLabHandoff(storage, bench, () => false).kind, 'cancelled');
  assert.equal(storage.getItem('botreborn.sim.bench'), original);
  assert.equal(storage.getItem(LAB_HANDOFF_KEY), null);
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'led-basics' }), true);
  const result = consumeLabHandoff(storage, bench, () => true);
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') throw Error('not applied');
  assert.equal(result.projectId, 'led-basics');
  assert.equal(evaluateLedBench(result.bench, 'led').state, 'on');
  assert.deepEqual(load(storage.getItem('botreborn.sim.bench')), result.bench);
});

test('BME280 project handoff requires confirmation and never plugs USB automatically', () => {
  const bench = emptyBench();
  const original = serialize(bench);
  const storage = store({ 'botreborn.sim.bench': original });
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'bme280-readings' }), true);
  assert.equal(consumeLabHandoff(storage, bench, () => false).kind, 'cancelled');
  assert.equal(storage.getItem('botreborn.sim.bench'), original);
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'bme280-readings' }), true);
  const result = consumeLabHandoff(storage, bench, () => true);
  assert.equal(result.kind, 'applied');
  if (result.kind !== 'applied') throw Error('not applied');
  assert.equal(result.projectId, 'bme280-readings');
  assert.equal(result.bench.usb, false);
  assert.ok(result.bench.placed.some(part => part.part === 'bme280-i2c'));
  assert.equal(result.bench.wires.length, 4);
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'bme280-readings', address: '0x76' }), true);
  const chosen = consumeLabHandoff(storage, bench, () => true);
  assert.equal(chosen.kind, 'applied');
  if (chosen.kind !== 'applied') throw Error('not applied');
  assert.equal(chosen.bench.placed.find(part => part.id === 'env')?.properties.address, '0x76');
});

test('a genuinely empty bench does not require replacement confirmation', () => {
  const original = emptyBench();
  const bare = { ...original, boards: [], wires: [], placed: original.placed.filter(part => part.id === 'esp') };
  const storage = store();
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'led-basics' }), true);
  assert.equal(consumeLabHandoff(storage, bare, () => { throw Error('unexpected confirmation'); }).kind, 'applied');
});

test('failure to remove a handoff leaves the original bench and pending request untouched', () => {
  const bench = emptyBench(), original = serialize(bench);
  const storage = store({ 'botreborn.sim.bench': original });
  assert.equal(queueLabHandoff(storage, { kind: 'add', part: 'led-5mm' }), true);
  const denied = { ...storage, removeItem() { throw Error('denied'); } };
  assert.equal(consumeLabHandoff(denied, bench, () => true).kind, 'error');
  assert.equal(storage.getItem('botreborn.sim.bench'), original);
  assert.ok(storage.getItem(LAB_HANDOFF_KEY));
});

test('future handoffs are not destroyed by an older workbench', () => {
  const future = JSON.stringify({ version: 2, kind: 'project', projectId: 'led-basics', future: true });
  const storage = store({ [LAB_HANDOFF_KEY]: future });
  assert.equal(consumeLabHandoff(storage, emptyBench(), () => true).kind, 'invalid');
  assert.equal(storage.getItem(LAB_HANDOFF_KEY), future);
  assert.equal(queueLabHandoff(storage, { kind: 'add', part: 'led-5mm' }), false);
  assert.equal(storage.getItem(LAB_HANDOFF_KEY), future);
});

test('malformed requests and storage failures never replace the bench', () => {
  const bench = emptyBench(), original = serialize(bench);
  const storage = store({ 'botreborn.sim.bench': original, [LAB_HANDOFF_KEY]: JSON.stringify({ version: 1, kind: 'project', projectId: 'toy' }) });
  assert.equal(consumeLabHandoff(storage, bench, () => true).kind, 'invalid');
  assert.equal(storage.getItem('botreborn.sim.bench'), original);
  const denied = { ...storage, setItem() { throw Error('denied'); } };
  assert.equal(queueLabHandoff(denied, { kind: 'add', part: 'led-5mm' }), false);
  assert.equal(queueLabHandoff(storage, /** @type {any} */ ({ kind: 'project', projectId: 'bme280-readings', address: '0x01' })), false);
  assert.equal(queueLabHandoff(storage, { kind: 'project', projectId: 'led-basics', address: '0x76' }), false);
  assert.equal(queueLabHandoff(storage, { kind: 'add', part: 'led-5mm' }), true);
  assert.equal(consumeLabHandoff(denied, bench, () => true).kind, 'error');
  assert.equal(storage.getItem('botreborn.sim.bench'), original);
});

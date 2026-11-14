import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire } from '../../sim/bench.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { projectSnapshot, validateProjectSnapshot } from '../../sim/project-snapshot.js';

const profile = PROFILES[0].id;
test('snapshot preserves every wire and semantic net with deterministic ordering', () => {
  let b = addWire(emptyBench(), 'esp:3V3', 'bb1:a1', 'red');
  b = addWire(b, 'bb1:b1', 'mic:VDD', 'orange');
  const s = projectSnapshot(b, profile);
  assert.deepEqual(Object.keys(s), ['version', 'profile', 'devices', 'connections', 'resources', 'firmware']);
  const wires = s.connections.filter(w => w.id);
  assert.equal(wires.length, 2);
  assert.deepEqual(wires.map(w => w.color).sort(), ['orange', 'red']);
  assert.ok(wires.every(w => w.members.includes('esp:3V3') && w.members.includes('mic:VDD')));
  assert.deepEqual(projectSnapshot({ ...b, placed: [...b.placed].reverse(), wires: [...b.wires].reverse() }, profile), s);
  assert.deepEqual(validateProjectSnapshot(s), []);
  assert.notDeepEqual(projectSnapshot({ ...b, wires: b.wires.map(w => ({ ...w, color: 'blue' })) }, profile), s);
});
test('device contracts and actual properties are copied', () => {
  const b = emptyBench();
  b.placed[0].properties = { z: 3, a: true };
  const s = projectSnapshot(b, profile);
  for (const p of b.placed) {
    const device = s.devices.find(d => d.instance === p.id);
    assert.deepEqual(device?.firmware, DEVICES[p.part].firmware);
    assert.deepEqual(device?.properties, p.properties);
  }
  assert.throws(() => projectSnapshot(b, 'missing'), /profile/i);
});
test('validation reports malformed nested data without throwing', () => {
  const s = projectSnapshot(emptyBench(), profile);
  for (const bad of [null, {}, { ...s, profile: 'missing' }, { ...s, devices: [null] }, { ...s, connections: [{ a: [], b: null, color: 3, members: [null] }] }, { ...s, resources: [null] }, { ...s, firmware: null }, { ...s, devices: [{ ...s.devices[0], firmware: { libraries: [null] } }] }]) {
    assert.ok(validateProjectSnapshot(bad).length > 0);
  }
});

test('deeply nested firmware data is rejected without overflowing', () => {
  const s = projectSnapshot(emptyBench(), profile);
  let nested = {};
  for (let i = 0; i < 10000; i++) nested = { nested };
  s.devices[0].firmware.init = nested;
  assert.ok(validateProjectSnapshot(s).length > 0);
});
test('references must identify real pins and unique device instances', () => {
  const s = projectSnapshot(addWire(emptyBench(), 'esp:3V3', 'mic:VDD', 'red'), profile);
  const wrongPin = structuredClone(s);
  wrongPin.connections[0].members.push('missing:NONEXISTENT');
  assert.ok(validateProjectSnapshot(wrongPin).length);
  const duplicate = structuredClone(s);
  duplicate.devices.push(structuredClone(duplicate.devices[0]));
  assert.ok(validateProjectSnapshot(duplicate).length);
});
test('profile resources must match the selected profile', () => {
  const s = projectSnapshot(emptyBench(), profile);
  const extra = structuredClone(s);
  const channels = extra.resources.find(r => r.name === 'pwmChannels');
  assert.ok(channels);
  channels.value = 100000;
  assert.ok(validateProjectSnapshot(extra).length);
  const missing = structuredClone(s);
  missing.resources.pop();
  assert.ok(validateProjectSnapshot(missing).length);
  const duplicate = structuredClone(s);
  duplicate.resources.push(structuredClone(duplicate.resources[0]));
  assert.ok(validateProjectSnapshot(duplicate).length);
});
test('all catalogue device contracts travel in a snapshot', () => {
  const b = emptyBench();
  const prototype = b.placed[0];
  b.placed = Object.keys(DEVICES).map((part, i) => ({ ...prototype, id: `device${i}`, part: /** @type {import('../../sim/bench.js').PartId} */ (part), properties: {} }));
  const s = projectSnapshot(b, profile);
  for (const d of s.devices) assert.deepEqual(d.firmware, DEVICES[d.part].firmware);
  assert.deepEqual(validateProjectSnapshot(s), []);
});
test('connections include internal joins and pins seated on the same strip', () => {
  const b = emptyBench();
  b.placed = b.placed.map(p => p.id === 'mic' ? { ...p, at: { x: -21, z: -6 }, seated: true } : p.id === 'amp' ? { ...p, at: { x: -21, z: -5 }, seated: true } : p);
  const s = projectSnapshot(b, profile);
  assert.ok(s.connections.some(c => c.members.includes('esp:GND') && c.members.some(p => p.startsWith('esp:GND.'))));
  assert.ok(s.connections.some(c => c.members.some(p => p.startsWith('mic:')) && c.members.some(p => p.startsWith('amp:'))));
});

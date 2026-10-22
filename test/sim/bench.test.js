import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, place, addWire, removeWire, swapBurnt, pinPoints, serialize, load } from '../../sim/bench.js';

test('a bench survives being written down and read back', () => {
  let b = emptyBench();
  b = place(b, 'mic', { x: 10, y: 3 }, 90);
  b = addWire(b, 'mic:VDD', 'esp:3V3', 'red');
  b = { ...b, usb: true };
  assert.deepEqual(load(serialize(b)), b);
});

test('anything unreadable is an empty bench', () => {
  const empty = emptyBench();
  assert.deepEqual(load('garbage'), empty);
  assert.deepEqual(load(null), empty);
  assert.deepEqual(load('{"v":0}'), empty);
  const flux = { ...empty, placed: [{ ...empty.placed[0], part: 'flux' }] };
  assert.deepEqual(load(JSON.stringify(flux)), empty);
});

test('the empty bench is one of each part on the table', () => {
  const b = emptyBench();
  assert.deepEqual(b.placed.map((p) => p.id), ['esp', 'mic', 'amp', 'spk']);
  assert.ok(b.placed.every((p) => p.at === null && !p.onBoard && !p.burnt && !p.discarded));
});

test('place does not change the bench it was given', () => {
  const b = emptyBench();
  const moved = place(b, 'mic', { x: 10, y: 3 }, 0);
  assert.equal(b.placed[1].at, null);
  assert.equal(moved.placed[1].onBoard, true);
  assert.throws(() => place(b, 'spk', { x: 1, y: 3 }, 0), /breadboard/);
});

test('wires get ids that are not reused after a removal', () => {
  let b = addWire(emptyBench(), 'mic:VDD', 'esp:3V3', 'red');
  b = addWire(b, 'mic:GND', 'esp:GND', 'black');
  const [first, second] = b.wires;
  b = removeWire(b, first.id);
  b = addWire(b, 'amp:Vin', 'esp:5V', 'red');
  assert.equal(b.wires.length, 2);
  assert.notEqual(b.wires[1].id, first.id);
  assert.notEqual(b.wires[1].id, second.id);
});

test('swapping a burnt mic leaves the old one beside the bench and a fresh one on it', () => {
  let b = place(emptyBench(), 'mic', { x: 10, y: 3 }, 0);
  b = addWire(b, 'mic:VDD', 'esp:3V3', 'red');
  b = swapBurnt(b, 'mic');
  const mics = b.placed.filter((p) => p.part === 'inmp441');
  assert.equal(mics.length, 2);
  const old = mics.find((p) => p.discarded);
  const fresh = mics.find((p) => !p.discarded);
  assert.equal(old?.burnt, true);
  assert.equal(fresh?.id, 'mic');
  assert.equal(fresh?.burnt, false);
  assert.equal(fresh?.at, null);
  assert.notEqual(old?.id, 'mic');
  assert.equal(b.wires.length, 1, 'wires name the point, so they stay with the new part');
});

test('a mic on the board has its six pins in six distinct holes', () => {
  const b = place(emptyBench(), 'mic', { x: 10, y: 3 }, 0);
  const mic = b.placed.find((p) => p.id === 'mic');
  assert.ok(mic);
  const holes = pinPoints(b, mic).map((p) => p.hole);
  assert.equal(holes.length, 6);
  assert.ok(holes.every((h) => h !== null));
  assert.equal(new Set(holes).size, 6);
});

test('a part on the table, and the amp terminal, have no holes', () => {
  let b = emptyBench();
  assert.ok(pinPoints(b, b.placed[1]).every((p) => p.hole === null));
  b = place(b, 'amp', { x: 5, y: 3 }, 0);
  const amp = pinPoints(b, b.placed[2]);
  assert.equal(amp.find((p) => p.pin === 'amp:+')?.hole, null);
  assert.notEqual(amp.find((p) => p.pin === 'amp:DIN')?.hole, null);
});

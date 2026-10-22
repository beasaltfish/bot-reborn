import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, place, addWire, swapBurnt } from '../../sim/bench.js';
import { nets } from '../../sim/netlist.js';

test('a wire to a strip reaches a mic pin plugged into the same strip', () => {
  let b = place(emptyBench(), 'mic', { x: 19, y: 5 }, 0); // L/R in c20, WS in c21, SCK in c22
  b = addWire(b, 'esp:GPIO12', 'bb:a22', 'red');
  const n = nets(b);
  assert.ok(n.same('esp:GPIO12', 'mic:SCK'));
  assert.ok(!n.same('esp:GPIO12', 'mic:WS'));
});

test('a mic with a row in the other half is not joined across the centre gap', () => {
  let b = place(emptyBench(), 'mic', { x: 19, y: 7 }, 0); // top row in e, bottom row in h
  b = addWire(b, 'esp:GPIO12', 'bb:a22', 'red');
  const n = nets(b);
  assert.ok(n.same('esp:GPIO12', 'mic:SCK'));
  assert.ok(!n.same('esp:GPIO12', 'mic:GND'));
  assert.ok(!n.same('mic:SCK', 'mic:GND'));
});

test('a mic with both rows in one half shorts its pins', () => {
  const b = place(emptyBench(), 'mic', { x: 19, y: 3 }, 0); // rows a and d
  assert.ok(nets(b).same('mic:L/R', 'mic:SD'));
});

test('every ESP32 ground pin is one net, and so is 3V3', () => {
  const n = nets(emptyBench());
  for (const p of ['esp:GND.2', 'esp:GND.3', 'esp:GND.4']) assert.ok(n.same('esp:GND', p));
  assert.ok(n.same('esp:3V3', 'esp:3V3.2'));
  assert.ok(!n.same('esp:GND', 'esp:3V3'));
  assert.ok(!n.same('esp:GND', 'esp:5V'));
});

test('a wire to any copy of a power pin reaches all of them', () => {
  const b = addWire(emptyBench(), 'bb:tn3', 'esp:GND.3', 'black');
  assert.ok(nets(b).same('bb:tn40', 'esp:GND'));
});

test('pins off the board join no net', () => {
  const b = place(emptyBench(), 'mic', { x: 19, y: 5 }, 0); // top row in c, bottom row in the gap
  const n = nets(b);
  for (const p of ['mic:SD', 'mic:VDD', 'mic:GND']) assert.deepEqual(n.members(p), [p]);
  assert.ok(!n.same('mic:SD', 'mic:VDD'));
  assert.equal(n.netOf('nowhere:x'), 'nowhere:x');
});

test('a wire with both ends in one strip changes nothing', () => {
  const b = emptyBench();
  const wired = addWire(b, 'bb:a5', 'bb:c5', 'red');
  assert.deepEqual(nets(wired).members('bb:a5'), nets(b).members('bb:a5'));
});

test('a strip lists its five holes and whatever is plugged in', () => {
  let b = place(emptyBench(), 'mic', { x: 19, y: 5 }, 0); // WS in c21
  b = addWire(b, 'bb:b21', 'esp:GPIO13', 'green');
  const m = nets(b).members('bb:a21');
  for (const r of 'abcde') assert.ok(m.includes(`bb:${r}21`));
  assert.ok(!m.includes('bb:f21'));
  assert.ok(m.includes('mic:WS'));
  assert.ok(m.includes('esp:GPIO13'));
});

test('a discarded part joins no net', () => {
  let b = place(emptyBench(), 'mic', { x: 19, y: 5 }, 0);
  b = swapBurnt(b, 'mic');
  // the burnt copy has moved to the table; put it back to prove it is ignored
  b = { ...b, placed: b.placed.map((p) => (p.discarded ? { ...p, at: { x: 19, y: 5 }, onBoard: true } : p)) };
  assert.deepEqual(nets(b).members('bb:a21'), ['bb:a21', 'bb:b21', 'bb:c21', 'bb:d21', 'bb:e21']);
});

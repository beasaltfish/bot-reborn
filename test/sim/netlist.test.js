import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addBoard, place, addWire } from '../../sim/bench.js';
import { nets } from '../../sim/netlist.js';

/** bb1's bottom edge, one long join away: bb1 is at (-31, -9). */
function twoBoards() {
  return addBoard(emptyBench(), { x: -31, z: -9 + 21 }, 0).bench;
}

/** The ESP32 with one row in bb1's j row and one in bb2's a row. */
function straddling() {
  return place(twoBoards(), 'esp', { x: -25, z: 5 }, 0, true);
}

test('a wire to a strip reaches a mic pin plugged into the same strip', () => {
  // The mic's top row sits in c20..c22: local (19, 5) on bb1.
  let b = place(emptyBench(), 'mic', { x: -12, z: -4 }, 0, true);
  b = addWire(b, 'esp:GPIO12', 'bb1:a22', 'red');
  const n = nets(b);
  assert.ok(n.same('esp:GPIO12', 'mic:SCK'));
  assert.ok(!n.same('esp:GPIO12', 'mic:WS'));
});

test('a mic with a row in the other half is not joined across the centre gap', () => {
  // Local (19, 7): top row in e, bottom row in f.
  let b = place(emptyBench(), 'mic', { x: -12, z: -2 }, 0, true);
  b = addWire(b, 'esp:GPIO12', 'bb1:a22', 'red');
  const n = nets(b);
  assert.ok(n.same('esp:GPIO12', 'mic:SCK'));
  assert.ok(!n.same('esp:GPIO12', 'mic:GND'));
  assert.ok(!n.same('mic:SCK', 'mic:GND'));
});

test('a mic with both rows in one half shorts its pins', () => {
  const b = place(emptyBench(), 'mic', { x: -12, z: -6 }, 0, true); // rows a and d
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
  const b = addWire(emptyBench(), 'bb1:tn3', 'esp:GND.3', 'black');
  assert.ok(nets(b).same('bb1:tn40', 'esp:GND'));
});

test('pins off the board join no net', () => {
  const b = place(emptyBench(), 'mic', { x: -12, z: -4 }, 0, true); // bottom row in the gap
  const n = nets(b);
  for (const p of ['mic:SD', 'mic:VDD', 'mic:GND']) assert.deepEqual(n.members(p), [p]);
  assert.ok(!n.same('mic:SD', 'mic:VDD'));
  assert.equal(n.netOf('nowhere:x'), 'nowhere:x');
});

test('a wire with both ends in one strip changes nothing', () => {
  const b = emptyBench();
  const wired = addWire(b, 'bb1:a5', 'bb1:c5', 'red');
  assert.deepEqual(nets(wired).members('bb1:a5'), nets(b).members('bb1:a5'));
});

test('a strip lists its five holes and whatever is plugged in', () => {
  let b = place(emptyBench(), 'mic', { x: -12, z: -4 }, 0, true); // WS in c21
  b = addWire(b, 'bb1:b21', 'esp:GPIO13', 'green');
  const m = nets(b).members('bb1:a21');
  for (const r of 'abcde') assert.ok(m.includes(`bb1:${r}21`));
  assert.ok(!m.includes('bb1:f21'));
  assert.ok(m.includes('mic:WS'));
  assert.ok(m.includes('esp:GPIO13'));
});

test('two joined boards keep their rails apart until a jumper joins them', () => {
  const b = twoBoards();
  assert.ok(!nets(b).same('bb1:bp1', 'bb2:tp1'));
  assert.ok(nets(addWire(b, 'bb1:bp1', 'bb2:tp1', 'red')).same('bb1:bp1', 'bb2:tp1'));
});

test('an ESP32 across two joined boards reaches a strip on each', () => {
  const n = nets(straddling());
  // GPIO12 is the fifth pin of the top row, in bb1's j row, so it joins that
  // column's bottom half…
  assert.ok(n.same('esp:GPIO12', 'bb1:f11'));
  assert.ok(!n.same('esp:GPIO12', 'bb1:a11'));
  // …and GPIO19 (third pin of the bottom row) is in bb2's a row, top half.
  assert.ok(n.same('esp:GPIO19', 'bb2:a9'));
  assert.ok(!n.same('esp:GPIO19', 'bb2:f9'));
  assert.ok(!n.same('esp:GPIO12', 'esp:GPIO19'));
});

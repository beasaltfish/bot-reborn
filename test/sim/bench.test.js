import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyBench, addPart, addBoard, place, moveBoard, trash,
  addWire, removeWire, pinPoints, isHole, serialize, load,
} from '../../sim/bench.js';
import { boardToTable } from '../../sim/parts.js';

/** @typedef {import('../../sim/bench.js').Bench} Bench */
/** @typedef {import('../../sim/bench.js').Placed} Placed */

/**
 * bb1 sits at (-31, -9); a second board along its bottom edge is one long
 * join further down.
 */
function twoBoards() {
  return addBoard(emptyBench(), { x: -31, z: -9 + 21 }, 0).bench;
}

/** The ESP32 with one row in bb1's j row and one in bb2's a row. */
function straddling() {
  return place(twoBoards(), 'esp', { x: -25, z: 5 }, 0, true);
}

/** @param {Bench} b @param {string} id */
const part = (b, id) => /** @type {Placed} */ (b.placed.find((p) => p.id === id));

test('a bench survives being written down and read back', () => {
  let b = place(emptyBench(), 'mic', { x: -12, z: -4 }, 90, true);
  b = addWire(b, 'mic:VDD', 'esp:3V3', 'red');
  b = { ...b, usb: true };
  assert.deepEqual(load(serialize(b)), b);
});

test('anything unreadable or from version 1 is an empty bench', () => {
  const empty = emptyBench();
  assert.deepEqual(load('garbage'), empty);
  assert.deepEqual(load(null), empty);
  assert.deepEqual(load('{"v":0}'), empty);
  assert.deepEqual(load(JSON.stringify({ ...empty, v: 1 })), empty);
  const flux = { ...empty, placed: empty.placed.map((p) => ({ ...p, part: 'flux' })) };
  assert.deepEqual(load(JSON.stringify(flux)), empty);
});

test('the opening bench is one of each part, and one board, on the table', () => {
  const b = emptyBench();
  assert.equal(b.v, 2);
  assert.deepEqual(b.placed.map((p) => p.id), ['esp', 'mic', 'amp', 'spk']);
  assert.ok(b.placed.every((p) => p.seated === false && !p.burnt));
  assert.deepEqual(b.placed.map((p) => p.at), [
    { x: -10.5, z: 16 }, { x: 29, z: 17.5 }, { x: 18, z: 15.5 }, { x: -34, z: 15.5 },
  ]);
  assert.deepEqual(b.boards, [{ id: 'bb1', x: -31, z: -9, rot: 0 }]);
});

test('place does not change the bench it was given, and checks the seat', () => {
  const b = emptyBench();
  const moved = place(b, 'mic', { x: -12, z: -4 }, 0, true);
  assert.equal(part(b, 'mic').seated, false);
  assert.equal(part(moved, 'mic').seated, true);
  assert.throws(() => place(b, 'spk', { x: -31, z: -6 }, 0, true), /breadboard/);
  assert.throws(() => place(b, 'mic', { x: -12.5, z: -4 }, 0, true), /grid/);
  assert.throws(() => place(b, 'mic', { x: 200, z: 200 }, 0, true), /hole/);
});

test('new parts get the smallest free number, and the first has none', () => {
  const b = emptyBench();
  const one = addPart(b, 'inmp441', { x: 0, z: 30 });
  assert.equal(one.id, 'mic2');
  const two = addPart(one.bench, 'inmp441', { x: 5, z: 30 });
  assert.equal(two.id, 'mic3');
  const board = addBoard(two.bench, { x: 40, z: 10 });
  assert.equal(board.id, 'bb2');
});

test('a part thrown away and replaced does not inherit its wires', () => {
  // Review Focus 3: mic2 is reused as an id, but nothing is still wired to it.
  let b = addPart(emptyBench(), 'inmp441', { x: 0, z: 30 }).bench;
  b = addWire(b, 'mic2:VDD', 'esp:3V3', 'red');
  b = /** @type {Bench} */ (trash(b, 'mic2'));
  const again = addPart(b, 'inmp441', { x: 0, z: 30 });
  assert.equal(again.id, 'mic2');
  assert.ok(again.bench.wires.every((w) => !w.a.startsWith('mic2:') && !w.b.startsWith('mic2:')));
});

test('there is no second ESP32 to take from the box', () => {
  // load() needs exactly one, so a bench with a second could never be read
  // back: a reload would silently start over. The bin has no ESP32 anyway.
  assert.throws(() => addPart(emptyBench(), 'esp32', { x: 0, z: 30 }), /one ESP32/);
});

test('the ESP32 cannot go in the bin', () => {
  assert.deepEqual(trash(emptyBench(), 'esp'), { refused: 'esp' });
  assert.deepEqual(trash(straddling(), 'esp'), { refused: 'esp' });
});

test('throwing a part away takes its wires, and the bench still saves', () => {
  // Review Focus 2: no wire may point at a part or a hole that is gone.
  let b = addWire(emptyBench(), 'mic:VDD', 'esp:3V3', 'red');
  b = addWire(b, 'mic:GND', 'esp:GND', 'black');
  b = addWire(b, 'amp:DIN', 'esp:GPIO14', 'blue');
  const after = /** @type {Bench} */ (trash(b, 'mic'));
  assert.equal(after.placed.some((p) => p.id === 'mic'), false);
  assert.deepEqual(after.wires.map((w) => w.a), ['amp:DIN']);
  assert.deepEqual(load(serialize(after)), after);
});

test('throwing a board away unseats its parts and takes the wires in its holes', () => {
  // Review Focus 1: the part falls back onto the table where it was; the
  // jumper that ended in one of that board's holes is gone with the board.
  let b = place(emptyBench(), 'mic', { x: -12, z: -4 }, 0, true);
  b = addWire(b, 'bb1:a22', 'esp:GPIO12', 'red');
  const before = { ...part(b, 'mic').at };
  const after = /** @type {Bench} */ (trash(b, 'bb1'));
  assert.deepEqual(part(after, 'mic').at, before);
  assert.equal(part(after, 'mic').seated, false);
  assert.deepEqual(after.boards, []);
  assert.deepEqual(after.wires, []);
  assert.deepEqual(load(serialize(after)), after);
});

test('moving one board moves its neighbours and everything plugged into them', () => {
  const b = straddling();
  const esp = part(b, 'esp');
  const holes = pinPoints(b, esp).map((p) => p.hole);
  assert.ok(holes.some((h) => h?.startsWith('bb1:')), 'one row on bb1');
  assert.ok(holes.some((h) => h?.startsWith('bb2:')), 'one row on bb2');

  const moved = /** @type {Bench} */ (moveBoard(b, 'bb1', { x: -21, z: -4 }, 0, false));
  assert.deepEqual(moved.boards, [
    { id: 'bb1', x: -21, z: -4, rot: 0 },
    { id: 'bb2', x: -21, z: 17, rot: 0 },
  ]);
  assert.deepEqual(part(moved, 'esp').at, { x: -15, z: 10 });
  assert.deepEqual(pinPoints(moved, part(moved, 'esp')).map((p) => p.hole), holes);
});

test('a board with a part across the seam cannot be taken off on its own', () => {
  const b = straddling();
  assert.deepEqual(moveBoard(b, 'bb1', { x: -21, z: -4 }, 0, true), { refused: 'spans' });
  // Lift the ESP first and the board comes away.
  const lifted = place(b, 'esp', { x: -25, z: 5 }, 0, false);
  const moved = /** @type {Bench} */ (moveBoard(lifted, 'bb1', { x: -21, z: -4 }, 0, true));
  assert.deepEqual(moved.boards.find((bd) => bd.id === 'bb2'), { id: 'bb2', x: -31, z: 12, rot: 0 });
  assert.deepEqual(part(moved, 'mic').at, part(lifted, 'mic').at);
});

test('a part and its board turned together keep the same holes', () => {
  const seated = place(emptyBench(), 'mic', { x: -21, z: -6 }, 0, true);
  const holes = pinPoints(seated, part(seated, 'mic')).map((p) => p.hole);
  assert.ok(holes.every((h) => h !== null));
  // The board moved and turned 90°; the mic turned with it, to the table
  // position of the same board-local point.
  const board = { id: 'bb1', x: 10, z: 20, rot: /** @type {const} */ (90) };
  const at = boardToTable(board, 10, 3);
  const turned = {
    ...seated,
    boards: [board],
    placed: seated.placed.map((p) => (p.id === 'mic' ? { ...p, at, rot: /** @type {const} */ (90) } : p)),
  };
  assert.deepEqual(pinPoints(turned, part(turned, 'mic')).map((p) => p.hole), holes);
});

test('a mic on the board has its six pins in six distinct holes', () => {
  // Local (10, 3): both rows in the a–e half, so all six pins are in holes.
  const b = place(emptyBench(), 'mic', { x: -21, z: -6 }, 0, true);
  const holes = pinPoints(b, part(b, 'mic')).map((p) => p.hole);
  assert.equal(holes.length, 6);
  assert.ok(holes.every((h) => h !== null));
  assert.equal(new Set(holes).size, 6);
});

test('a part on the table, and the amp terminal, have no holes', () => {
  let b = emptyBench();
  assert.ok(pinPoints(b, part(b, 'mic')).every((p) => p.hole === null));
  b = place(b, 'amp', { x: -26, z: -4 }, 0, true);
  const amp = pinPoints(b, part(b, 'amp'));
  assert.equal(amp.find((p) => p.pin === 'amp:+')?.hole, null);
  assert.notEqual(amp.find((p) => p.pin === 'amp:DIN')?.hole, null);
});

test('a wire may end on a hole or a pin, and nothing else', () => {
  const b = place(emptyBench(), 'mic', { x: -12, z: -4 }, 0, true);
  assert.equal(isHole(b, 'bb1:a22'), true);
  assert.equal(isHole(b, 'bb1:z99'), false);
  assert.equal(isHole(b, 'bb9:a1'), false);
  assert.equal(isHole(b, 'esp:GND'), false);
});

test('a saved bench that is not a whole bench loads as an empty one', () => {
  const empty = emptyBench();
  /** @param {(b: Bench) => unknown} edit */
  const bad = (edit) => load(JSON.stringify(edit(structuredClone(empty))));
  // No ESP32 to build the bench around, or two of them.
  assert.deepEqual(bad((b) => ({ ...b, placed: b.placed.filter((p) => p.id !== 'esp') })), empty);
  assert.deepEqual(bad((b) => ({ ...b, placed: [...b.placed, { ...b.placed[0], id: 'esp2' }] })), empty);
  // Duplicate ids, a part that does not exist, a floating pin.
  assert.deepEqual(bad((b) => ({ ...b, placed: [...b.placed, { ...b.placed[1] }] })), empty);
  assert.deepEqual(bad((b) => ({ ...b, placed: b.placed.map((p) => (p.id === 'mic' ? { ...p, part: 'flux' } : p)) })), empty);
  // A wire to a point nothing has.
  assert.deepEqual(bad((b) => ({ ...b, wires: [{ id: 'w1', a: 'mic:NOPE', b: 'esp:3V3', color: 'red' }] })), empty);
  assert.deepEqual(bad((b) => ({ ...b, wires: [{ id: 'w1', a: 'bb1:z99', b: 'esp:3V3', color: 'red' }] })), empty);
  assert.deepEqual(bad((b) => ({ ...b, wires: [{ id: 'w1', a: 'bb9:a1', b: 'esp:3V3', color: 'red' }] })), empty);
  // A seated part that is not on the hole grid.
  assert.deepEqual(bad((b) => ({ ...b, placed: b.placed.map((p) => (p.id === 'mic' ? { ...p, at: { x: -12.5, z: -4 }, seated: true } : p)) })), empty);
  // The good ones still load.
  const ok = addWire(place(emptyBench(), 'mic', { x: -12, z: -4 }, 0, true), 'mic:VDD', 'bb1:a1', 'red');
  assert.deepEqual(load(serialize(ok)), ok);
});

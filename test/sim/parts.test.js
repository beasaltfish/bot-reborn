import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PARTS, holeStrip, holeXY, holeAt, stripHoles,
  boardToTable, tableToBoard, holeOnTable, boardGroups,
} from '../../sim/parts.js';
import { TARGET } from '../../sim/target.js';

// The simulator's rules (which holes are joined, what a wire reaches) all
// rest on these tables, so what they promise is pinned down here.

/** @typedef {import('../../sim/parts.js').Board} Board */

test('holes in one half-column share a strip, and the centre gap splits it', () => {
  assert.equal(holeStrip('a12'), holeStrip('e12'));
  assert.notEqual(holeStrip('e12'), holeStrip('f12'));
  assert.notEqual(holeStrip('a12'), holeStrip('a13'));
  assert.equal(holeStrip('g12'), 'col12-bottom');
});

test('a rail is one strip along its whole length', () => {
  assert.equal(holeStrip('tp1'), holeStrip('tp50'));
  assert.equal(holeStrip('tp7'), 'tp');
  assert.notEqual(holeStrip('tp1'), holeStrip('tn1'));
});

test('holeAt is the inverse of holeXY for every hole', () => {
  const c40 = holeXY('c40');
  assert.equal(holeAt(c40.x, c40.y), 'c40');
  for (const rail of ['tp', 'tn', 'bp', 'bn']) {
    for (const n of [1, 5, 6, 50]) {
      const id = `${rail}${n}`;
      const { x, y } = holeXY(id);
      assert.equal(holeAt(x, y), id);
    }
  }
  assert.equal(holeAt(-5, -5), null);
  assert.throws(() => holeXY('z1'));
});

test('the ESP32 has the pins the firmware uses, and its grounds are joined', () => {
  const names = PARTS.esp32.pins.map((p) => p.name);
  for (const n of ['GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', '3V3', '5V', 'GND']) {
    assert.ok(names.includes(n), n);
  }
  assert.equal(new Set(names).size, names.length, 'point ids must be unique');
  assert.equal(PARTS.esp32.pins.length, 44);
  const gnd = PARTS.esp32.internal.find((g) => g.includes('GND'));
  assert.equal(gnd?.length, 4);
});

test('every TARGET endpoint names a real pin', () => {
  const byInstance = { esp: 'esp32', mic: 'inmp441', amp: 'max98357a', spk: 'speaker' };
  /** @param {string} point */
  const exists = (point) => {
    const [inst, pin] = point.split(':');
    const part = PARTS[/** @type {keyof typeof PARTS} */ (byInstance[/** @type {keyof typeof byInstance} */ (inst)])];
    return !!part && part.pins.some((p) => p.name === pin);
  };
  assert.ok(TARGET.length > 0);
  for (const link of TARGET) {
    assert.ok(exists(link.a), link.a);
    assert.ok(exists(link.b), link.b);
    assert.ok(link.why.length > 0);
  }
});

test('stripHoles lists every hole joined on a strip', () => {
  assert.deepEqual(stripHoles('col52-bottom'), ['f52', 'g52', 'h52', 'i52', 'j52']);
  assert.deepEqual(stripHoles('col3-top'), ['a3', 'b3', 'c3', 'd3', 'e3']);
  assert.equal(stripHoles('tp').length, 50);
  assert.deepEqual(stripHoles('nowhere'), []);
});

test('boardToTable and tableToBoard are inverses at every rotation', () => {
  for (const rot of /** @type {const} */ ([0, 90, 180, 270])) {
    const bd = { id: 'bb1', x: 7, z: -3, rot };
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [5, 14], [-1.6, -1.8], [62, 17]]) {
      const t = boardToTable(bd, x, y);
      const back = tableToBoard(bd, t.x, t.z);
      // A rotation is a float multiply, so -1.6 comes back as -1.5999999999999996.
      assert.ok(Math.abs(back.x - x) < 1e-9, `${rot}: x ${back.x}`);
      assert.ok(Math.abs(back.y - y) < 1e-9, `${rot}: y ${back.y}`);
    }
  }
});

test('a quarter turn maps local +x to table +z', () => {
  assert.deepEqual(boardToTable(/** @type {Board} */ ({ id: 'bb1', x: 10, z: 20, rot: 90 }), 1, 0), { x: 10, z: 21 });
});

test('holeOnTable names the hole on whichever board is under the point', () => {
  /** @type {Board[]} */
  const boards = [
    { id: 'bb1', x: 0, z: 0, rot: 0 },
    { id: 'bb2', x: 0, z: 21, rot: 0 },
  ];
  assert.equal(holeOnTable(boards, 5, 24), 'bb2:a6');
  assert.equal(holeOnTable(boards, 5, 14), 'bb1:j6');
  assert.equal(holeOnTable(boards, 5, 19), null, 'the seam between the two is not a hole');
  assert.equal(holeOnTable(boards, 5, 80), null);
});

test('joined boards are one group, and only the given joins count', () => {
  const bb1 = /** @type {Board} */ ({ id: 'bb1', x: 0, z: 0, rot: 0 });
  /** @param {Board[]} bs */
  const groups = (bs) => boardGroups(bs).map((g) => g.sort()).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(groups([bb1, { id: 'bb2', x: 0, z: 21, rot: 0 }]), [['bb1', 'bb2']]);
  assert.deepEqual(groups([bb1, { id: 'bb2', x: 0, z: 22, rot: 0 }]), [['bb1'], ['bb2']]);
  assert.deepEqual(groups([bb1, { id: 'bb2', x: 0, z: 21, rot: 180 }]), [['bb1'], ['bb2']]);
  assert.deepEqual(groups([bb1, { id: 'bb2', x: 66, z: 0, rot: 0 }]), [['bb1', 'bb2']]);
  assert.deepEqual(groups([
    bb1, { id: 'bb2', x: 0, z: 21, rot: 0 }, { id: 'bb3', x: 0, z: 42, rot: 0 },
  ]), [['bb1', 'bb2', 'bb3']]);
});

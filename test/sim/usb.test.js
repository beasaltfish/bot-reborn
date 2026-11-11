import test from 'node:test';
import assert from 'node:assert/strict';

import { PARTS } from '../../sim/parts.js';
import { emptyBench, addBoard, addPart, place, park } from '../../sim/bench.js';
import { BOARD_TOP } from '../../sim/scene/meshes.js';
import { groundAt } from '../../sim/scene/usb.js';

// How high the thing at a table point is, which is how high the USB cord has
// to lie to get over it. Boards and the parts around them are a few
// millimetres; the toy robot is 120 mm of body on wheels, and a cable is not
// draped across it — it lies on the table and the chassis stands over it.

const MM = 1 / 2.54;

/** Open table: the opening bench with its board and its four parts taken off. */
const bare = () => ({ ...emptyBench(), boards: [], placed: [] });

test('the cord lies over a board, and over the low parts on the table', () => {
  assert.ok(Math.abs(groundAt({ ...emptyBench(), placed: [] }, -10, 0) - BOARD_TOP) < 1e-9);
  // A speaker lying loose is 15 mm: a cable goes over that.
  const spk = addPart(bare(), 'speaker', { x: 0, z: 0 }).bench;
  assert.ok(Math.abs(groundAt(spk, 0, 0) - PARTS.speaker.size.h * MM) < 1e-9);
  // A part pushed into a board rides on the board: the board's top plus its own height.
  const mic = place(addPart(addBoard(bare(), { x: -31, z: -9 }).bench, 'inmp441', { x: -25, z: 5 }).bench, 'mic', { x: -25, z: 5 }, 0, true);
  assert.ok(Math.abs(groundAt(mic, -25, 5) - (BOARD_TOP + PARTS.inmp441.size.h * MM)) < 1e-9);
});

test('the cord does not climb the toy robot, whatever way it faces', () => {
  const toy = park(addPart(bare(), 'toy', { x: 0, z: 0 }).bench, 'toy', { x: 0, z: 0 }, 0);
  assert.equal(groundAt(toy, 10, 10), 0);
  // Turned a quarter, it still stands on the same table: the cord stays down.
  const turned = park(toy, 'toy', { x: 0, z: 0 }, 90);
  assert.equal(groundAt(turned, -10, 10), 0);
});

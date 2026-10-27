import test from 'node:test';
import assert from 'node:assert/strict';

import { PARTS } from '../../sim/parts.js';
import { snapPart, snapBoard, freeSpot } from '../../sim/snap.js';
import { emptyBench, addBoard, addPart, place, pinPoints } from '../../sim/bench.js';

// Where a dropped part or board lands decides which strips it joins, so the
// snap is pinned down here: on the grid, or not on the board at all.

/** @typedef {import('../../sim/bench.js').Bench} Bench */

/** bb1's bottom edge, one long join away: bb1 is at (-31, -9). */
const twoBoardBench = () => addBoard(emptyBench(), { x: -31, z: -9 + 21 }, 0).bench;

test('a mic dropped between holes snaps to the grid', () => {
  assert.deepEqual(snapPart(emptyBench(), PARTS.inmp441, -12.3, -5.2, 0), { x: -12, z: -5 });
});

test('a mic dropped far off the board stays on the table', () => {
  assert.equal(snapPart(emptyBench(), PARTS.inmp441, 120, 40, 0), null);
  assert.equal(snapPart(emptyBench(), PARTS.inmp441, -30, 30, 90), null);
});

test('a part hanging half off the edge still lands if one pin is in a hole', () => {
  // Local (62, 14) is hole j63, the last hole of the bottom row.
  assert.deepEqual(snapPart(emptyBench(), PARTS.inmp441, 31, 5, 0), { x: 31, z: 5 });
});

test('a snapped part has every pin it can on a hole, as the netlist reads it', () => {
  const at = snapPart(emptyBench(), PARTS.max98357a, -11, -2, 180);
  assert.ok(at);
  const b = place(emptyBench(), 'amp', at, 180, true);
  const amp = /** @type {any} */ (b.placed.find((p) => p.id === 'amp'));
  const holes = pinPoints(b, amp).filter((p) => !p.pin.endsWith(':+') && !p.pin.endsWith(':-'));
  assert.ok(holes.every((p) => p.hole !== null), JSON.stringify(holes));
});

test('the speaker never goes into the board', () => {
  assert.equal(snapPart(emptyBench(), PARTS.speaker, -12, 3, 0), null);
});

test('an ESP32 dropped across two boards gets both rows into holes', () => {
  const b = twoBoardBench();
  const at = snapPart(b, PARTS.esp32, -25.4, 5.2, 0);
  assert.deepEqual(at, { x: -25, z: 5 });
  const seated = place(b, 'esp', /** @type {any} */ (at), 0, true);
  const esp = /** @type {any} */ (seated.placed.find((p) => p.id === 'esp'));
  const holes = pinPoints(seated, esp).map((p) => p.hole);
  assert.equal(holes.length, 44);
  assert.ok(holes.every((h) => h !== null));
  assert.ok(holes.some((h) => h?.startsWith('bb1:')) && holes.some((h) => h?.startsWith('bb2:')));
});

test('a dropped board joins the nearest edge, and stays put when it is far', () => {
  const b = emptyBench();
  assert.deepEqual(snapBoard(b, 'bb2', -31, -9 + 21 + 1.3, 0), { x: -31, z: 12 });
  assert.deepEqual(snapBoard(b, 'bb2', -31, -9 + 21 + 5, 0), { x: -31, z: 17 });
  // Side by side on the short edge: one board length along.
  assert.deepEqual(snapBoard(b, 'bb2', -31 + 66 + 1, -9, 0), { x: 35, z: -9 });
});

test('freeSpot returns the point asked for when nothing is in the way', () => {
  assert.deepEqual(freeSpot(emptyBench(), { w: 4, d: 4 }, -12, 30), { x: -12, z: 30 });
});

test('freeSpot steps off a part that is in the way, and not onto a board', () => {
  const b = addPart(emptyBench(), 'inmp441', { x: 0, z: 30 }).bench;
  const spot = freeSpot(b, { w: 4, d: 4 }, 0, 30);
  assert.notDeepEqual(spot, { x: 0, z: 30 });
  // The mic is 14 mm across, sitting with its origin at (0, 30).
  const mic = 14 / 2.54;
  const hit = spot.x + 2 > 0 && spot.x - 2 < mic && spot.z + 2 > 30 && spot.z - 2 < 30 + mic;
  assert.ok(!hit, JSON.stringify(spot));
  // A 4×4 drop on top of the board is moved off it.
  const off = freeSpot(b, { w: 4, d: 4 }, -20, 0);
  const onBoard = off.x + 2 > -31 - 1.6 && off.x - 2 < -31 + 63.6 && off.z + 2 > -9 - 1.8 && off.z - 2 < -9 + 18.8;
  assert.ok(!onBoard, JSON.stringify(off));
});

test('a moved id is not in its own way', () => {
  const b = addPart(emptyBench(), 'inmp441', { x: 0, z: 30 }).bench;
  const id = /** @type {any} */ (b.placed.at(-1)).id;
  assert.deepEqual(freeSpot(b, { w: 4, d: 4 }, 0, 30, [id]), { x: 0, z: 30 });
});

/** Keeps the type checker honest about the helper's shape. */
void (/** @type {(b: Bench) => Bench} */ (twoBoardBench));

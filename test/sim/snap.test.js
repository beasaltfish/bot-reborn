import test from 'node:test';
import assert from 'node:assert/strict';

import { PARTS, holeXY } from '../../sim/parts.js';
import { snapPart } from '../../sim/snap.js';
import { emptyBench, place, pinPoints } from '../../sim/bench.js';

// Where a dropped part lands decides which strips its pins join, so the snap
// is pinned down here: on the grid, or not on the board at all.

test('a mic dropped between holes snaps to the grid', () => {
  assert.deepEqual(snapPart(PARTS.inmp441, 10.3, 3.8, 0), { x: 10, y: 4 });
});

test('a mic dropped far off the board stays on the table', () => {
  assert.equal(snapPart(PARTS.inmp441, 120, 40, 0), null);
  assert.equal(snapPart(PARTS.inmp441, -30, -30, 90), null);
});

test('a part hanging half off the edge still lands if one pin is in a hole', () => {
  const { x, y } = holeXY('bb:j63');
  // The mic's top row (y 0) at row j; its bottom row three pitches below falls off.
  assert.deepEqual(snapPart(PARTS.inmp441, x, y, 0), { x, y });
});

test('a snapped part has every pin it can on a hole, as the netlist reads it', () => {
  const at = snapPart(PARTS.max98357a, 20.4, 6.6, 180);
  assert.ok(at);
  const b = place(emptyBench(), 'amp', at, 180);
  const amp = b.placed.find((p) => p.id === 'amp');
  assert.ok(amp);
  const holes = pinPoints(b, amp).filter((p) => !p.pin.endsWith(':+') && !p.pin.endsWith(':-'));
  assert.ok(holes.every((p) => p.hole !== null), JSON.stringify(holes));
});

test('the speaker never goes into the board', () => {
  assert.equal(snapPart(PARTS.speaker, 10, 5, 0), null);
});

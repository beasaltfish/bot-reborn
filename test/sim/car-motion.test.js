import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart } from '../../sim/bench.js';
import { BIN } from '../../sim/layout.js';
import { CAR, actionAt, centreOf, obstacles, overlaps, stepCar } from '../../sim/car.js';

const BOUNDS = { x0: -120, x1: 120, z0: -70, z1: 70 };
/** Ground with nothing on it but the mat: these tests are geometry, not benches. */
const ground = (/** @type {Record<string, any>} */ extra = {}) => ({
  bounds: BOUNDS, obstacles: [], leash: null, ...extra,
});
/** @param {number} x @param {number} z @param {number} [heading] */
const at = (x, z, heading = 0) => ({ x, z, heading });
const forward = { wheels: 'forward', steer: 'straight' };

test('the body centre is half a body ahead of the origin, and turns with it', () => {
  assert.deepEqual(centreOf(at(0, 0)), { x: CAR.half.x, z: CAR.half.z });
  const turned = centreOf(at(0, 0, 90));
  assert.ok(Math.abs(turned.x + CAR.half.z) < 1e-9, String(turned.x));
  assert.ok(Math.abs(turned.z - CAR.half.x) < 1e-9, String(turned.z));
});

test('half a second of forward travel is CAR.speed×500 along the heading', () => {
  const { pose, blocked } = stepCar(at(0, 0), forward, 500, ground());
  assert.equal(blocked, null);
  assert.equal(pose.x, 50);
  assert.equal(pose.z, 0);
});

test('backward goes the other way, and coast neither moves nor turns', () => {
  assert.equal(stepCar(at(0, 0), { wheels: 'backward', steer: 'straight' }, 500, ground()).pose.x, -50);
  assert.deepEqual(stepCar(at(0, 0), { wheels: 'coast', steer: 'left' }, 500, ground()).pose, at(0, 0));
});

test('left decreases the heading, right increases it, and the path curves', () => {
  // Open ground: half a second of turning covers 50 units, and the mat edge
  // would otherwise cut the right-hand curve short.
  const open = ground({ bounds: { x0: -1000, x1: 1000, z0: -1000, z1: 1000 } });
  const left = stepCar(at(0, 0), { wheels: 'forward', steer: 'left' }, 500, open).pose;
  assert.equal(left.heading, -45);
  assert.ok(left.z < 0, 'left of a +x heading is -z');
  const right = stepCar(at(0, 0), { wheels: 'forward', steer: 'right' }, 500, open).pose;
  assert.equal(right.heading, 45);
  assert.ok(right.z > 0);
});

test('the mat edge stops it, and the body never leaves the mat', () => {
  const { pose, blocked } = stepCar(at(60, 0), forward, 4000, ground());
  assert.equal(blocked, 'edge');
  assert.equal(overlaps(pose, ground()), false);
  // The origin stops where the body's edge meets the mat: no size hardcoded.
  const reach = BOUNDS.x1 - CAR.radius - CAR.half.x;
  assert.ok(pose.x <= reach + 1e-9 && pose.x > reach - 0.5, `${pose.x} vs ${reach}`);
});

test('a board in the way is stopped at, not overlapped', () => {
  const g = ground({ obstacles: [{ x0: 20, x1: 40, z0: -10, z1: 10 }] });
  const { pose, blocked } = stepCar(at(-40, -10), forward, 1000, g);
  assert.equal(blocked, 'hit');
  assert.equal(overlaps(pose, g), false);
  // It got right up to it: one more millisecond still hits.
  assert.equal(stepCar(pose, forward, 1, g).blocked, 'hit');
  const reach = 20 - CAR.radius - CAR.half.x;
  assert.ok(pose.x <= reach + 1e-9 && pose.x > reach - 0.5, `${pose.x} vs ${reach}`);
});

test('being driven into a wall twice gives the same pose, not a jitter', () => {
  const g = ground({ obstacles: [{ x0: 20, x1: 40, z0: -10, z1: 10 }] });
  const first = stepCar(at(-40, -10), forward, 1000, g).pose;
  assert.deepEqual(stepCar(first, forward, 1000, g).pose, first);
});

test('a body that starts inside something cannot move at all', () => {
  const g = ground({ obstacles: [{ x0: 0, x1: 40, z0: 0, z1: 30 }] });
  const { pose, blocked } = stepCar(at(0, -10), forward, 1000, g);
  assert.equal(blocked, 'stuck');
  assert.deepEqual(pose, at(0, -10));
});

test('a taut leash stops it, measured from the origin the wires end on', () => {
  const g = ground({
    bounds: { x0: -1000, x1: 1000, z0: -1000, z1: 1000 },
    leash: { points: [{ x: 0, z: 0 }], radius: CAR.leash, slack: 2 },
  });
  const { pose, blocked } = stepCar(at(0, 0), forward, 3000, g);
  assert.equal(blocked, 'taut');
  assert.ok(Math.hypot(pose.x, pose.z) + 2 <= CAR.leash + 1e-6, String(pose.x));
});

test('obstacles are the boards, the other parts and the bin, never the toy itself', () => {
  const bench = /** @type {any} */ ({
    v: 2,
    boards: [{ id: 'bb1', x: -31, z: -9, rot: 0 }],
    placed: [],
    wires: [],
    usb: false,
  });
  const b = addPart(bench, 'toy', { x: -100, z: 25 }).bench;
  const rects = obstacles(b, 'toy');
  assert.equal(rects.length, 2, JSON.stringify(rects)); // the board and the bin
  assert.ok(rects.some((r) => r.x0 < -32 && r.x1 > 32), 'bb1 spans the middle');
  assert.ok(rects.some((r) => r.x0 === BIN.x - BIN.size / 2 && r.z1 === BIN.z + BIN.size / 2), 'the bin');
});

test('an order runs for its ms and then the pins go low, as motion_now does', () => {
  // firmware/test/test_motion.c pins the same boundary: 1599 is still moving,
  // 1600 is stop/straight, because a move ends by itself.
  const go = { wheels: 'forward', steer: 'left' };
  assert.deepEqual(actionAt(go, 1600, 1599), go);
  assert.deepEqual(actionAt(go, 1600, 1600), { wheels: 'coast', steer: 'centred' });
  assert.deepEqual(actionAt(null, 1600, 100), { wheels: 'coast', steer: 'centred' });
  assert.deepEqual(actionAt(go, Infinity, 1e9), go);
});

test('turning a toy on the bench keeps its middle where the hand left it', () => {
  // What the R key does: the facing changes, the body's centre does not move.
  // (sim/scene/interact.js builds the new origin exactly this way.)
  const before = centreOf({ x: -55, z: -55, heading: 0 });
  for (const step of [15, 90, 137, 270]) {
    const heading = step;
    const offset = centreOf({ x: 0, z: 0, heading });
    const origin = { x: before.x - offset.x, z: before.z - offset.z };
    const after = centreOf({ ...origin, heading });
    assert.ok(Math.abs(after.x - before.x) < 1e-9, `${step}: ${after.x} vs ${before.x}`);
    assert.ok(Math.abs(after.z - before.z) < 1e-9, `${step}: ${after.z} vs ${before.z}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { createShake, runMeter } from '../../sim/shake.js';

/**
 * A hand moving at `speed` px/ms, sampled every 16 ms until `until`.
 * @param {ReturnType<typeof createShake>} s @param {number} speed @param {number} until
 */
function run(s, speed, until) {
  for (let t = 16; t <= until; t += 16) s.move(speed * 16, t);
}

test('a fresh tracker reads 0', () => {
  assert.equal(createShake().level(0), 0);
  assert.equal(createShake().level(10_000), 0);
});

test('steady fast movement approaches 1', () => {
  const s = createShake({ full: 2, fall: 500 });
  run(s, 2, 500);
  assert.ok(s.level(500) > 0.9, `level was ${s.level(500)}`);
});

test('slow movement stays low', () => {
  const s = createShake({ full: 2, fall: 500 });
  run(s, 0.1, 500);
  assert.ok(s.level(500) < 0.2, `level was ${s.level(500)}`);
});

test('the level falls to 0 within `fall` ms of the last move', () => {
  const s = createShake({ full: 2, fall: 500 });
  run(s, 2, 500);
  const peak = s.level(500);
  const half = s.level(750);
  assert.ok(half > 0 && half < peak, `half-way level was ${half}, peak ${peak}`);
  assert.equal(s.level(1000), 0);
});

test('level never leaves 0..1', () => {
  const s = createShake();
  s.move(0, 0);
  s.move(1e6, 1);
  assert.equal(s.level(1), 1);
  assert.equal(createShake().level(-5), 0);
});

test('a gentle first touch does not spike the meter', () => {
  // The first call only starts the clock: the hand has moved ~16 ms of distance
  // since the event before it, which the tracker never saw.
  const s = createShake({ full: 2, fall: 500 });
  s.move(1.6, 16);
  assert.ok(s.level(16) < 0.2, `level was ${s.level(16)}`);
  s.move(1.6, 32);
  s.move(1.6, 48);
  assert.ok(s.level(48) < 0.2, `level was ${s.level(48)}`);
});

/** A frame loop that lets the test play the frames by hand and see who left it. */
function fakeLoop() {
  /** @type {((now: number) => boolean) | null} */
  let tick = null;
  const seen = { offs: 0, dones: 0, shown: /** @type {number[]} */ ([]), held: true };
  const hooks = {
    onFrame: (/** @type {(now: number) => boolean} */ fn) => { tick = fn; return () => { seen.offs++; }; },
    show: (/** @type {number} */ level) => { seen.shown.push(level); },
    held: () => seen.held,
    done: () => { seen.dones++; },
  };
  return { seen, hooks, frame: (/** @type {number} */ now) => /** @type {(now: number) => boolean} */ (tick)(now) };
}

test('the meter loop wants frames while the wand is held, even at level 0', () => {
  const loop = fakeLoop();
  runMeter(createShake(), loop.hooks);
  assert.equal(loop.frame(10), true);
  assert.equal(loop.seen.offs, 0);
});

test('once let go and quiet, the meter loop shows 0, leaves the frame loop and says so, once', () => {
  const loop = fakeLoop();
  const s = createShake({ full: 2, fall: 500 });
  s.move(0, 0);
  s.move(100, 16);
  runMeter(s, loop.hooks);
  loop.seen.held = false;
  assert.equal(loop.frame(20), true, 'still falling');
  assert.equal(loop.frame(2000), false);
  assert.deepEqual([loop.seen.offs, loop.seen.dones], [1, 1]);
  assert.equal(loop.seen.shown.at(-1), 0);
});

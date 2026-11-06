import test from 'node:test';
import assert from 'node:assert/strict';

import { createShake } from '../../sim/shake.js';

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
  s.move(1e6, 1);
  assert.equal(s.level(1), 1);
  assert.equal(createShake().level(-5), 0);
});

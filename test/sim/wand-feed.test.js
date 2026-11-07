import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWandFeed } from '../../sim/wand-feed.js';
import { createShakeDetector } from '../../core/shake-detector.js';

function rig() {
  let t = 0;
  let sent = 0;
  const feed = createWandFeed({ detector: createShakeDetector(), send: () => { sent++; }, now: () => t });
  /** Step the clock 50 ms at a time, reporting `level` (or nothing when null) before each tick. */
  const run = (/** @type {number} */ ms, /** @type {number | null} */ level) => {
    for (let end = t + ms; t < end;) { t += 50; if (level !== null) feed.level(level); feed.tick(); }
  };
  return { run, sent: () => sent };
}

test('a shake, then the meter falling to nothing, sends one shake', () => {
  const r = rig();
  r.run(1500, 0.6);
  r.run(3000, 0);
  assert.equal(r.sent(), 1);
});

test('a wand that never reports a level (burnt, miswired) never sends', () => {
  const r = rig();
  r.run(5000, null);
  assert.equal(r.sent(), 0);
});

test('one flick is not a shake', () => {
  const r = rig();
  r.run(50, 0.9);
  r.run(3000, 0);
  assert.equal(r.sent(), 0);
});

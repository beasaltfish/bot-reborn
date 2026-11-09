import test from 'node:test';
import assert from 'node:assert/strict';

import { TIMING, speedFactor, pauseFor, runRecipe } from '../../sim/scene/autowire.js';

test('a wire holds longer than a part, which holds longer than the plug', () => {
  assert.ok(TIMING.wire > TIMING.part);
  assert.ok(TIMING.part > TIMING.usb);
});

test('every step kind has a pause, and 2× halves it', () => {
  for (const kind of ['wire', 'usb', 'board', 'part']) {
    const once = pauseFor({ kind }, 1);
    assert.ok(once > 0, kind);
    assert.equal(pauseFor({ kind }, 2), once / 2, kind);
  }
});

test('a speed the page cannot use means 1×, never zero', () => {
  for (const bad of [0, -1, NaN, Infinity, undefined, null, /** @type {any} */ ('2')]) {
    assert.equal(speedFactor(bad), 1, String(bad));
    assert.equal(pauseFor({ kind: 'wire' }, bad), TIMING.wire, String(bad));
  }
});

test('the default speed is 1×', () => {
  assert.equal(pauseFor({ kind: 'wire' }), TIMING.wire);
});

/** A run of two plug steps (no bench, no scene): the shortest way to watch the pacing itself. */
/** @param {number} speed */
function timeRun(speed) {
  return new Promise((resolve) => {
    const started = performance.now();
    runRecipe(/** @type {any} */ ({
      steps: /** @type {any} */ ([{ kind: 'usb' }, { kind: 'usb' }]),
      mode: 'watch',
      speed,
      getBench: () => ({}),
      setBench: () => {},
      world: {},
      usb: { insert: async () => {} },
      hands: { enable: () => {} },
      say: () => {},
      onDone: () => resolve(performance.now() - started),
    }));
  });
}

test('runRecipe halves the wait between steps at 2×', async () => {
  const once = await timeRun(1);
  const twice = await timeRun(2);
  assert.ok(once >= TIMING.usb * 2, `1× ran in ${once}ms, expected at least ${TIMING.usb * 2}`);
  assert.ok(twice < once * 0.7, `2× ran in ${twice}ms against 1×'s ${once}ms`);
});

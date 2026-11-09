import test from 'node:test';
import assert from 'node:assert/strict';

import { TIMING, speedFactor, pauseFor } from '../../sim/scene/autowire.js';

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

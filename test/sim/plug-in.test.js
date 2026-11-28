import test from 'node:test';
import assert from 'node:assert/strict';

import { bootMode, screenUrl } from '../../sim/firmware/runtime.js';

test('a flash session boots no old firmware', () => {
  assert.equal(bootMode({ blocked: false, pendingFlash: 'sketch-env-display' }), 'bootloader');
});

test('a blocked board does not boot, even with a flash pending', () => {
  assert.equal(bootMode({ blocked: true, pendingFlash: 'sketch-env-display' }), 'blocked');
});

test('a plain insert boots the firmware that is on the board', () => {
  assert.equal(bootMode({ blocked: false, pendingFlash: null }), 'boot');
});

test('the screen link follows the body link to the same brain', () => {
  assert.equal(screenUrl('ws://brain:8787/body'), 'ws://brain:8787/screen');
  assert.equal(screenUrl(''), '');
});

// A demo that names its body asks a question before pairing: which character
// wears it. Pairing first would lock in whatever was ready.

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoPairAllowed } from '../../sim/provision.js';

test('a body demo waits for the answer before pairing', () => {
  assert.equal(autoPairAllowed({ body: 'led-module' }, false), false);
});

test('the answer unblocks pairing', () => {
  assert.equal(autoPairAllowed({ body: 'led-module' }, true), true);
});

test('an empty bench has no question to ask', () => {
  assert.equal(autoPairAllowed({}, false), true);
  assert.equal(autoPairAllowed(null, false), true);
});

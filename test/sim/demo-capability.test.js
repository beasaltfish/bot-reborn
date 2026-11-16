import test from 'node:test';
import assert from 'node:assert/strict';
import { canDo } from '../../sim/capabilities.js';
import { MOTIONS } from '../../core/config.js';

test('every motion is evaluated against CAN_DO', () => {
  for (const motion of MOTIONS) assert.equal(typeof canDo([], motion), 'boolean');
});

test('a tarot character needs no action for the audio demo', () => {
  assert.equal(canDo([], 'tarot'), true);
});

test('a car character cannot pose', () => {
  assert.equal(canDo(['pose'], 'car'), false);
  assert.equal(canDo(['move'], 'car'), true);
});

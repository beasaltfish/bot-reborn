import test from 'node:test';
import assert from 'node:assert/strict';
import { canDo, demoSkips, lookupCharacter } from '../../sim/capabilities.js';
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

test('a missing capability is explained, not blocked', () => {
  const skips = demoSkips(['pose'], 'car', 'en');
  assert.equal(skips.length, 1);
  assert.match(skips[0].text, /cannot pose/);
  assert.match(demoSkips(['pose'], 'car', 'zh')[0].text, /不能摆姿势/);
  assert.equal(demoSkips(['dance'], 'car')[0].text, 'This step is skipped.');
});

test('a remote brain never matches a local same-name character', () => {
  const list = [{ name: 'Rex', motion: 'car' }];
  assert.deepEqual(lookupCharacter(list, 'Rex', false), list[0]);
  assert.equal(lookupCharacter(list, 'Rex', true), null);
  assert.equal(lookupCharacter(list, 'Nope', false), null);
});

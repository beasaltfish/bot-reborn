import test from 'node:test';
import assert from 'node:assert/strict';
import { canDo, demoSkips, lookupCharacter } from '../../sim/capabilities.js';
import { TEMPLATE_IDS, TEMPLATES } from '../../core/bodies.js';
import { verbsOf } from '../../core/actions.js';

/** @param {import('../../core/bodies.js').BodyId} id */
const verbs = (id) => verbsOf(TEMPLATES[id].actions);

test('every body is judged by the verbs it can run, and an empty demand always fits', () => {
  for (const id of TEMPLATE_IDS) {
    assert.equal(typeof canDo([], verbs(id)), 'boolean');
    assert.equal(canDo([], verbs(id)), true);
  }
});

test('a tarot character needs no verb for the audio demo', () => {
  assert.equal(canDo([], verbs('tarot')), true);
});

test('a car character cannot pose, and its way of moving is the drive verb', () => {
  assert.equal(canDo(['pose'], verbs('toy')), false);
  assert.equal(canDo(['move'], verbs('toy')), true, 'a demo asks to move; the body runs drive');
  assert.equal(canDo(['pose'], verbs('pet')), true);
  assert.equal(canDo(['draw'], verbs('tarot')), true);
});

test('a missing capability is explained, not blocked', () => {
  const skips = demoSkips(['pose'], verbs('toy'), 'en');
  assert.equal(skips.length, 1);
  assert.match(skips[0].text, /cannot pose/);
  assert.match(demoSkips(['pose'], verbs('toy'), 'zh')[0].text, /不能摆姿势/);
  assert.equal(demoSkips(['dance'], verbs('toy'))[0].text, 'This step is skipped.');
});

test('only the verbs a body declares count — an id is not a capability', () => {
  // sim/main.js passes `character.verbs`; a page that predates the field sends
  // an empty list, and nothing is credited to it by name.
  assert.equal(canDo(['move'], []), false);
  assert.equal(canDo(['move'], ['drive']), true);
  assert.equal(canDo(['draw'], ['draw']), true);
});

test('a remote brain never matches a local same-name character', () => {
  const list = [{ name: 'Rex', motion: 'toy' }];
  assert.deepEqual(lookupCharacter(list, 'Rex', false), list[0]);
  assert.equal(lookupCharacter(list, 'Rex', true), null);
  assert.equal(lookupCharacter(list, 'Nope', false), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWandState } from '../../sim/wand-state.js';

const awake = { kind: 'imu', awake: true };
const asleep = { kind: 'imu', awake: false };

test('a wand is awake only when power-on said so', () => {
  const w = createWandState();
  w.set([{ id: 'imu' }, { id: 'imu2' }], { imu: awake, imu2: asleep });
  assert.equal(w.awake('imu'), true);
  assert.equal(w.awake('imu2'), false);
  assert.equal(w.awake('never-seen'), false);
});

test('a new power-on replaces the old one, so unplugging puts every wand to sleep', () => {
  const w = createWandState();
  w.set([{ id: 'imu' }], { imu: awake });
  w.set([{ id: 'imu' }], { imu: asleep });
  assert.equal(w.awake('imu'), false);
});

test('states of other kinds are ignored', () => {
  const w = createWandState();
  w.set([{ id: 'mic' }], { mic: { kind: 'mic', path: 'ok' } });
  assert.equal(w.awake('mic'), false);
});

test('a wand thrown in the bin does not pass its "awake" to a new wand with the same id', () => {
  const w = createWandState();
  w.set([{ id: 'imu' }], { imu: awake });
  w.prune([]); // the bench no longer has it; the bin hands out `imu` again next
  assert.equal(w.awake('imu'), false);
});

test('pruning keeps the wands that are still on the bench', () => {
  const w = createWandState();
  w.set([{ id: 'imu' }, { id: 'imu2' }], { imu: awake, imu2: awake });
  w.prune([{ id: 'imu2' }]);
  assert.deepEqual([w.awake('imu'), w.awake('imu2')], [false, true]);
});

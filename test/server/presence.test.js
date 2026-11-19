import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresence } from '../../server/presence.js';

test('presence remembers the first time a body was seen and first spoke', () => {
  let clock = 1000;
  const p = createPresence(() => clock);
  assert.deepEqual(p.of('asten'), {});
  p.saw('asten'); clock = 4000;
  p.spoke('asten'); clock = 9000;
  p.saw('asten'); p.spoke('asten');
  assert.deepEqual(p.of('asten'), { lastSeenAt: 1000, lastSpokeAt: 4000 });
  assert.deepEqual(p.of('rex'), {});
});

test('one body’s memory does not leak into another’s', () => {
  let clock = 100;
  const p = createPresence(() => clock);
  p.saw('a');
  clock = 200;
  p.saw('b');
  clock = 300;
  p.spoke('b');
  assert.deepEqual(p.of('a'), { lastSeenAt: 100 });
  assert.deepEqual(p.of('b'), { lastSeenAt: 200, lastSpokeAt: 300 });
});

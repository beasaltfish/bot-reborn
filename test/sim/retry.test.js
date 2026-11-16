import test from 'node:test';
import assert from 'node:assert/strict';

import { nextRetryMs, rejectIsFinal, BUSY_GIVE_UP_MS } from '../../sim/firmware/retry.js';
import { ledPattern } from '../../sim/firmware/led.js';

test('retries back off 500, 1000, 2000, 5000 and repeat the last', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(nextRetryMs), [500, 1000, 2000, 5000, 5000, 5000]);
});

test('token and origin are final, busy is retried until the budget ends', () => {
  assert.equal(rejectIsFinal('token', 0, 0), true);
  assert.equal(rejectIsFinal('origin', 0, 0), true);
  assert.equal(rejectIsFinal('busy', 0, BUSY_GIVE_UP_MS - 1), false);
  assert.equal(rejectIsFinal('busy', 0, BUSY_GIVE_UP_MS), true);
});

test('the LED uses the firmware duty table', () => {
  assert.deepEqual(ledPattern('NO_WIFI'), { onMs: 100, offMs: 100 });
  assert.deepEqual(ledPattern('CONNECTING'), { onMs: 100, offMs: 900 });
  assert.deepEqual(ledPattern('REJECTED'), { onMs: 1000, offMs: 1000 });
  assert.equal(ledPattern('LISTENING'), 'solid');
  assert.equal(ledPattern('SPEAKING'), 'solid');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectCopy } from '../../sim/ui/reject-copy.js';

test('a refusal names what to fix', () => {
  assert.match(rejectCopy('unconfigured', 'en'), /Ears.*Mind.*Voice/);
  assert.match(rejectCopy('token', 'en'), /token/i);
  assert.match(rejectCopy('unconfigured', 'zh'), /听.*想.*说/);
  assert.match(rejectCopy('busy', 'en'), /rejected: busy/);
});

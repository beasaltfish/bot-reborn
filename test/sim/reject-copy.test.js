import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectCopy } from '../../sim/ui/reject-copy.js';

test('a refusal names what to fix', () => {
  assert.match(rejectCopy('unconfigured', 'en'), /Ears.*Mind.*Voice/);
  assert.match(rejectCopy('token', 'en'), /token/i);
  // The token is not shown in the admin page; the picker is where it comes from.
  assert.match(rejectCopy('token', 'en'), /pick the character.*serial panel/i);
  assert.match(rejectCopy('token', 'zh'), /串口.*选中角色/);
  assert.match(rejectCopy('unconfigured', 'zh'), /听.*想.*说/);
  assert.match(rejectCopy('busy', 'en'), /rejected: busy/);
  // A v2 body on a plugin character is told why, in both languages.
  assert.match(rejectCopy('bridge', 'en'), /protocol 3.*protocol 2/);
  assert.match(rejectCopy('bridge', 'zh'), /协议 3.*协议 2/);
});

test('a prototype name is not a translation', () => {
  assert.equal(rejectCopy('constructor', 'en'), 'rejected: constructor — fix it, then type reboot');
  assert.equal(rejectCopy('constructor', 'zh'), 'rejected: constructor — fix it, then type reboot');
});

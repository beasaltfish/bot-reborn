import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalRequest } from '../../server/local-guard.js';

const req = (/** @type {string} */ remoteAddress, /** @type {string | undefined} */ host) =>
  ({ socket: { remoteAddress }, headers: { host } });

test('this machine, addressed as itself, is local', () => {
  for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    for (const host of ['localhost:8787', '127.0.0.1:8787', '[::1]:8787', 'LOCALHOST:8787', 'localhost']) {
      assert.equal(isLocalRequest(req(addr, host)), true, `${addr} ${host}`);
    }
  }
});

test('another machine on the LAN is not, whatever Host it claims', () => {
  assert.equal(isLocalRequest(req('192.168.3.20', 'localhost:8787')), false);
  assert.equal(isLocalRequest(req('::ffff:192.168.3.20', '127.0.0.1:8787')), false);
});

test('a rebound domain is not, even from this machine', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', 'evil.example:8787')), false);
  assert.equal(isLocalRequest(req('127.0.0.1', '192.168.3.79:8787')), false);
  assert.equal(isLocalRequest(req('127.0.0.1', undefined)), false);
});

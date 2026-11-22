import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, parse } from '../core/protocol.js';

test('cmd and result are the only new wire messages', () => {
  assert.ok(parse(encode({ type: 'cmd', id: 1, op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0, timeoutMs: 200 }), 'brain'));
  assert.ok(parse(encode({ type: 'result', id: 1, ok: true, value: 1 }), 'body'));
  assert.equal(parse(encode({ type: 'cmd', op: 'pin.write' }), 'brain'), null, 'no id');
});

test('a result without a boolean ok, or from the wrong side, is refused', () => {
  assert.equal(parse(encode({ type: 'result', id: 1, value: 1 }), 'body'), null);
  assert.equal(parse(encode({ type: 'result', id: 1, ok: true }), 'brain'), null);
  assert.equal(parse(encode({ type: 'cmd', id: 1, op: 'pin.write' }), 'body'), null);
});

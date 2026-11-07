import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../core/protocol.js';

test('parse accepts a shake from a body, and not from a brain', () => {
  assert.deepEqual(parse('{"type":"shake"}', 'body'), { type: 'shake' });
  assert.equal(parse('{"type":"shake"}', 'brain'), null);
});

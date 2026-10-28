import test from 'node:test';
import assert from 'node:assert/strict';

import { faultOf } from '../../core/fault.js';
import { requestError } from '../../core/providers/request-error.js';
import { parse } from '../../core/protocol.js';

const keyEcho = '{"error":{"message":"Incorrect API key provided: sk-abc123"}}';

test('an http error carries its status', async () => {
  const err = await requestError('LLM', new Response(keyEcho, { status: 401 }));
  assert.deepEqual(faultOf('llm', err), { type: 'fault', part: 'llm', status: 401, kind: 'http' });
});

test('a 401 that echoes the key sends no text', async () => {
  const err = await requestError('LLM', new Response(keyEcho, { status: 401 }));
  assert.ok(!JSON.stringify(faultOf('llm', err)).includes('sk-abc'));
});

test('a timeout is a timeout', () => {
  const a = faultOf('stt', new Error('Volcengine STT timed out after 8000 ms'));
  assert.equal(a.status, null);
  assert.equal(a.kind, 'timeout');
  const named = new Error('x');
  named.name = 'TimeoutError';
  assert.equal(faultOf('stt', named).kind, 'timeout');
});

test('a refused connection is network', () => {
  assert.equal(faultOf('llm', new TypeError('fetch failed')).kind, 'network');
});

test('anything else is other', () => {
  const f = faultOf('tts', new Error('Volcengine TTS 45000010: x'));
  assert.equal(f.status, null);
  assert.equal(f.kind, 'other');
});

test('the brain protocol accepts a fault and rejects an unknown part', () => {
  assert.notEqual(parse('{"type":"fault","part":"llm","status":401,"kind":"http"}', 'brain'), null);
  assert.equal(parse('{"type":"fault","part":"xyz","status":401,"kind":"http"}', 'brain'), null);
});

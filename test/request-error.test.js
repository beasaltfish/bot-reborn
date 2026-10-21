import test from 'node:test';
import assert from 'node:assert/strict';

import { requestError } from '../core/providers/request-error.js';

/** @param {number} status @param {string} body */
const reply = (status, body, statusText = '') => new Response(body, { status, statusText });

test('an OpenAI-shaped error says what the provider said', async () => {
  const err = await requestError('LLM', reply(401, JSON.stringify({ error: { message: 'Invalid API key' } })));
  assert.equal(err.message, 'LLM request failed: 401 Unauthorized — Invalid API key');
});

test("SiliconFlow's flat message is read too, and an empty statusText gets its standard name", async () => {
  // HTTP/2 carries no reason phrase, which is how a bare "402" reached the screen.
  const err = await requestError('TTS', reply(402, JSON.stringify({ code: 30001, message: 'Sorry, your account balance is insufficient' })));
  assert.equal(err.message, 'TTS request failed: 402 Payment Required — Sorry, your account balance is insufficient');
});

test("FastAPI's detail is read too, as Unsloth Studio sends it", async () => {
  const err = await requestError('Reflex', reply(400, JSON.stringify({ detail: 'Unknown model' })));
  assert.equal(err.message, 'Reflex request failed: 400 Bad Request — Unknown model');
});

test('a plain-text body is shown, cut short', async () => {
  const err = await requestError('STT', reply(500, `oops ${'x'.repeat(500)}`, 'Internal Server Error'));
  assert.ok(err.message.startsWith('STT request failed: 500 Internal Server Error — oops '));
  assert.ok(err.message.length < 280, err.message);
});

test('an empty body leaves just the status', async () => {
  const err = await requestError('TTS', reply(418, ''));
  assert.equal(err.message, 'TTS request failed: 418');
});

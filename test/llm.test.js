import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompatLlm } from '../web/providers/llm-openai-compat.js';

const CFG = { baseURL: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'deepseek-v4-flash' };

/** @param {any} message */
function respond(message) {
  /** @type {any} */
  const seen = {};
  /** @param {any} url @param {any} init */
  const fetchImpl = async (url, init) => {
    seen.url = url;
    seen.body = JSON.parse(init.body);
    seen.headers = init.headers;
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  return { seen, fetchImpl };
}

test('chat(): posts messages and tools to /chat/completions', async () => {
  const { seen, fetchImpl } = respond({ role: 'assistant', content: 'ok' });
  const llm = new OpenAiCompatLlm(CFG, { fetch: fetchImpl });
  const tools = [{ type: 'function', function: { name: 'stop', description: 'Stop the car immediately.', parameters: { type: 'object', properties: {} } } }];

  const result = await llm.chat([{ role: 'user', content: 'hi' }], tools);

  assert.equal(seen.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(seen.headers['Content-Type'], 'application/json');
  assert.equal(seen.headers.Authorization, 'Bearer sk-test');
  assert.equal(seen.body.model, 'deepseek-v4-flash');
  assert.deepEqual(seen.body.tools, tools);
  assert.equal(result.text, 'ok');
  assert.deepEqual(result.toolCalls, []);
});

test('chat(): never asks for strict mode (spec §6.1)', async () => {
  const { seen, fetchImpl } = respond({ role: 'assistant', content: 'ok' });
  await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);
  assert.equal(seen.body.strict, undefined);
  assert.equal(seen.body.tool_choice, undefined);
});

test('chat(): parses tool_calls and keeps the raw arguments string', async () => {
  const { fetchImpl } = respond({
    role: 'assistant',
    content: null,
    tool_calls: [{
      id: 'call_1', type: 'function',
      function: { name: 'move', arguments: '{"steps":[{"drive":"forward","steer":"straight","duration_ms":600}]}' },
    }],
  });
  const result = await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);

  assert.equal(result.text, '');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call_1');
  assert.equal(result.toolCalls[0].name, 'move');
  assert.deepEqual(/** @type {any} */ (result.toolCalls[0].args).steps[0], { drive: 'forward', steer: 'straight', duration_ms: 600 });
});

test('chat(): text and tool_calls arrive together and BOTH survive (spec §6.3)', async () => {
  const { fetchImpl } = respond({
    role: 'assistant',
    content: 'I cannot turn an exact 45 degrees, so I will just go roughly left.',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'move', arguments: '{"steps":[]}' } }],
  });
  const result = await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);

  assert.match(result.text, /roughly left/);
  assert.equal(result.toolCalls.length, 1);
});

test('chat(): malformed arguments give args=null rather than throwing', async () => {
  // A provider is allowed to emit broken JSON. Throwing here would lose the
  // whole turn; brain.js drops the individual call instead (spec §6.6).
  const { fetchImpl } = respond({
    role: 'assistant', content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'move', arguments: '{"steps":[' } }],
  });
  const result = await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);
  assert.equal(result.toolCalls[0].args, null);
  assert.equal(result.toolCalls[0].rawArguments, '{"steps":[');
});

test('chat(): a call with no id still gets one (spec §6.4 pairing)', async () => {
  // `id` is required by the OpenAI schema, but backends do omit it. Passing
  // `undefined` through would put `tool_call_id: undefined` into the history
  // and hard-fail the NEXT request on the unpaired call — the failure
  // test/brain.test.js exists to prevent, one turn later and far from here.
  const { fetchImpl } = respond({
    role: 'assistant', content: null,
    tool_calls: [
      { type: 'function', function: { name: 'stop', arguments: '{}' } },
      { type: 'function', function: { name: 'cruise', arguments: '{}' } },
    ],
  });
  const result = await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);
  const ids = result.toolCalls.map((c) => c.id);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, 2, 'two calls in one turn must not share an id');
});

test('chat(): an id the backend DID send is never rewritten', async () => {
  const { fetchImpl } = respond({
    role: 'assistant', content: null,
    tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'stop', arguments: '{}' } }],
  });
  const result = await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);
  assert.equal(result.toolCalls[0].id, 'call_abc');
});

test('chat(): rawMessage is returned untouched, for the history (spec §6.4)', async () => {
  const message = {
    role: 'assistant', content: null,
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'stop', arguments: '{}' } }],
  };
  const { fetchImpl } = respond(message);
  const result = await new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []);
  assert.deepEqual(result.rawMessage, message);
});

test('chat(): an HTTP error throws with the status', async () => {
  const fetchImpl = async () => new Response('{}', { status: 500 });
  await assert.rejects(() => new OpenAiCompatLlm(CFG, { fetch: fetchImpl }).chat([], []), /500/);
});

test('chat(): a hung request aborts at timeoutMs', async () => {
  /** @param {any} url @param {any} init */
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const llm = new OpenAiCompatLlm(CFG, { fetch: fetchImpl, timeoutMs: 20 });
  await assert.rejects(() => llm.chat([], []), (err) => /** @type {any} */ (err).name === 'AbortError');
});

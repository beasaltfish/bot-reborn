import test from 'node:test';
import assert from 'node:assert/strict';

import { MATERIAL, checkStt, checkLlm, checkReflex } from '../core/checks.js';

const PCM = new Int16Array([0, 100, -100]);

test('checkStt hands the clip to the provider as it was given', async () => {
  /** @type {any[]} */ const seen = [];
  await checkStt({ transcribe: async (pcm, rate) => { seen.push([pcm, rate]); return 'ok'; } }, PCM, 24000);
  assert.deepEqual(seen, [[PCM, 24000]]);
});

test('checkStt treats an empty transcript as a failure', async () => {
  // A key with the wrong scope is accepted and answers with nothing. Reporting
  // that as a pass sends somebody off to debug a microphone that is fine.
  await assert.rejects(() => checkStt({ transcribe: async () => '   ' }, PCM, 16000), /came back empty/);
});

test('checkStt returns the transcript when there is one', async () => {
  assert.equal(await checkStt({ transcribe: async () => ' hello ' }, PCM, 16000), 'hello');
});

const llmDeps = { tools: [], systemPrompt: 'system' };

test('checkLlm fails a model that answers with no text', async () => {
  await assert.rejects(
    () => checkLlm({ chat: async () => ({ text: '', toolCalls: [] }) }, llmDeps),
    /returned no text/);
});

test('checkLlm fails a model that chats but cannot call a tool', async () => {
  // The two are different capabilities, and a chat-only provider looks
  // entirely healthy until the car is told to move and nothing happens.
  let call = 0;
  await assert.rejects(
    () => checkLlm({
      chat: async () => (++call === 1
        ? { text: 'ok', toolCalls: [] }
        : { text: '', toolCalls: [] }),
    }, llmDeps),
    /did not call a tool/);
});

test('checkLlm passes only when both answers arrive, and names the tool', async () => {
  let call = 0;
  const out = await checkLlm({
    chat: async () => (++call === 1
      ? { text: 'ok', toolCalls: [] }
      : { text: '', toolCalls: [{ name: 'move' }] }),
  }, llmDeps);
  assert.match(out, /ok/);
  assert.match(out, /move/);
});

test('the Chinese material code-switches and the English material does not', () => {
  // The zh line carries both languages because a voice that can only read one
  // of them fails silently otherwise — it reads the half it knows and sounds
  // perfectly fine doing it. The en line must NOT, or an English-only user is
  // being failed for a capability they will never use.
  assert.match(MATERIAL.zh.line, /[一-鿿]/);
  assert.match(MATERIAL.zh.line, /[a-z]/i);
  assert.doesNotMatch(MATERIAL.en.line, /[一-鿿]/);
  assert.match(MATERIAL.en.line, /[a-z]/i);
});

test('each language has its own clip, and they are different files', () => {
  // One clip shared between them is the bug this table exists to prevent: it
  // means one of the two languages is being tested with the other's audio.
  assert.notEqual(MATERIAL.en.clip, MATERIAL.zh.clip);
  for (const lang of /** @type {const} */ (['en', 'zh'])) {
    assert.match(MATERIAL[lang].clip, /^fixtures\/.+\.wav$/);
  }
});

test('checkReflex asks the sentence it is given, and says what would happen', async () => {
  /** @type {any[]} */ const asked = [];
  const reflex = /** @type {any} */ ({ judge: async (/** @type {string} */ h, /** @type {string} */ r) => {
    asked.push([h, r]);
    return { verdict: 'fired', detail: 'left 0.97', ms: 180,
      calls: [{ name: 'move', args: {}, rawArguments: '{}' }] };
  } });
  assert.equal(await checkReflex(reflex, 'turn left', 'Okay!'), '“turn left” → fired (left 0.97, 180 ms) → move');
  assert.deepEqual(asked, [['turn left', 'Okay!']]);
});

test('checkReflex: a pass says so without actions', async () => {
  const reflex = /** @type {any} */ ({ judge: async () => ({ verdict: 'passed', detail: 'pass 0.99', ms: 150 }) });
  assert.equal(await checkReflex(reflex, 'how are you'), '“how are you” → passed (pass 0.99, 150 ms)');
});

test('checkReflex fails when no verdict came back', async () => {
  // judge() never rejects; `failed` is how a bad key or a timeout arrives.
  const reflex = /** @type {any} */ ({ judge: async () => ({ verdict: 'failed', detail: 'HTTP 401', ms: 300 }) });
  await assert.rejects(() => checkReflex(reflex, 'hi'), /HTTP 401 after 300 ms/);
});

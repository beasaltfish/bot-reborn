import test from 'node:test';
import assert from 'node:assert/strict';

import { VolcengineStt } from '../core/providers/stt-volcengine.js';

const CFG = { baseURL: 'https://openspeech.bytedance.com', apiKey: 'k-123', model: 'volc.bigasr.auc_turbo', prompt: 'woof' };

/**
 * @param {{ status?: number, code?: string, message?: string, body?: unknown }} answer
 */
function fake(answer) {
  /** @type {{ url: string, init: RequestInit }[]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    calls.push({ url, init });
    /** @type {Record<string, string>} */ const headers = {};
    if (answer.code) headers['X-Api-Status-Code'] = answer.code;
    if (answer.message) headers['X-Api-Message'] = answer.message;
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers });
  });
  f.calls = calls;
  return f;
}

const PCM = new Int16Array(1600).fill(1000);

test('posts the clip as base64 WAV to the flash endpoint with key, resource and request id', async () => {
  const f = fake({ code: '20000000', body: { result: { text: 'ok' } } });
  await new VolcengineStt(CFG, { fetch: f }).transcribe(PCM, 16000);
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash');
  const h = /** @type {Record<string, string>} */ (init.headers);
  assert.equal(h['X-Api-Key'], 'k-123');
  assert.equal(h['X-Api-Resource-Id'], 'volc.bigasr.auc_turbo');
  assert.ok(h['X-Api-Request-Id']);
  const body = JSON.parse(/** @type {string} */ (init.body));
  assert.equal(Buffer.from(body.audio.data, 'base64').subarray(0, 4).toString('ascii'), 'RIFF');
  // Not sent until a real key shows it steers anything (spec §5.2 item 3).
  assert.ok(!/** @type {string} */ (init.body).includes('woof'));
});

test('returns the transcript on 20000000', async () => {
  const f = fake({ code: '20000000', body: { result: { text: ' 往前走 ' } } });
  const stt = new VolcengineStt(CFG, { fetch: f });
  assert.equal(await stt.transcribe(PCM, 16000), '往前走');
  assert.deepEqual(await stt.transcribeDetailed(PCM, 16000), { text: '往前走', noSpeech: null, logprob: null, parts: 0 });
});

test('silence (20000003) is empty text, not an error', async () => {
  const f = fake({ code: '20000003', message: 'silence audio', body: {} });
  assert.equal(await new VolcengineStt(CFG, { fetch: f }).transcribe(PCM, 16000), '');
});

test('HTTP 200 with another status code is an error naming code and message', async () => {
  const f = fake({ code: '45000001', message: 'invalid audio', body: {} });
  await assert.rejects(new VolcengineStt(CFG, { fetch: f }).transcribe(PCM, 16000),
    /Volcengine STT 45000001: invalid audio/);
});

test('an HTTP 401 goes through requestError', async () => {
  const f = fake({ status: 401, body: { error: 'bad key' } });
  await assert.rejects(new VolcengineStt(CFG, { fetch: f }).transcribe(PCM, 16000), /401/);
});

test('a 200 with no status header is an error, not an empty transcript', async () => {
  // What a wrong path behind a gateway looks like. Taking it as success makes
  // the robot answer every sentence with "huh?" and log nothing.
  const f = fake({ body: { something: 'else' } });
  await assert.rejects(new VolcengineStt(CFG, { fetch: f }).transcribe(PCM, 16000), /no status/);
});

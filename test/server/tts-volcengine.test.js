import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VolcengineTtsSource } from '../../server/providers/tts-volcengine.js';

const CFG = { baseURL: 'https://openspeech.bytedance.com', apiKey: 'k-1', model: 'seed-tts-2.0', voice: 'zh_female_xiaohe_uranus_bigtts' };

/** @param {number[]} samples */
const b64 = (samples) => Buffer.from(new Int16Array(samples).buffer).toString('base64');

/** @param {string} text @param {number} [status] */
function fake(text, status = 200) {
  /** @type {{ url: string, init: RequestInit }[]} */ const calls = [];
  const f = /** @type {any} */ (async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    calls.push({ url, init });
    return new Response(text, { status });
  });
  f.calls = calls;
  return f;
}

const lines = (/** @type {object[]} */ ...xs) => xs.map((x) => JSON.stringify(x)).join('\n');

test('asks seed-tts-2.0 for 16 kHz PCM in the configured voice', async () => {
  const f = fake(lines({ code: 0, data: b64([1]) }, { code: 20000000, message: 'ok' }));
  await new VolcengineTtsSource(CFG, { fetch: f }).synthesize('你好');
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
  const h = /** @type {Record<string, string>} */ (init.headers);
  assert.equal(h['X-Api-Key'], 'k-1');
  assert.equal(h['X-Api-Resource-Id'], 'seed-tts-2.0');
  assert.ok(h['X-Api-Request-Id']);
  const body = JSON.parse(/** @type {string} */ (init.body));
  assert.equal(body.req_params.speaker, CFG.voice);
  assert.equal(body.req_params.text, '你好');
  assert.deepEqual(body.req_params.audio_params, { format: 'pcm', sample_rate: 16000 });
});

test('joins every audio chunk of a multi-line answer in order', async () => {
  const f = fake(lines({ code: 0, data: b64([1, 2]) }, { code: 0, data: b64([3]) }, { code: 20000000, message: 'ok' }) + '\n');
  const { samples, rate } = await new VolcengineTtsSource(CFG, { fetch: f }).synthesize('hi');
  assert.equal(rate, 16000);
  assert.deepEqual([...samples].map((x) => Math.round(x * 32768)), [1, 2, 3]);
});

test('a line with an error code rejects with Volcengine TTS <code>: <message>', async () => {
  const f = fake(lines({ code: 45000000, message: 'speaker permission denied' }));
  await assert.rejects(new VolcengineTtsSource(CFG, { fetch: f }).synthesize('hi'),
    /Volcengine TTS 45000000: speaker permission denied/);
});

test('an HTTP error goes through requestError', async () => {
  const f = fake('{"error":"bad key"}', 401);
  await assert.rejects(new VolcengineTtsSource(CFG, { fetch: f }).synthesize('hi'), /401/);
});

test('an answer with no audio at all is an error, not a silent robot', async () => {
  const f = fake(lines({ code: 20000000, message: 'ok' }));
  await assert.rejects(new VolcengineTtsSource(CFG, { fetch: f }).synthesize('hi'), /no audio/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAdminApi } from '../../server/admin-api.js';
import { MATERIAL } from '../../core/checks.js';
import { DEFAULT_STATE } from '../../core/config.js';
import { tempCharacters, fakeFetch } from './helpers.js';

const W = { 'X-Bot-Reborn': '1', 'Content-Type': 'application/json' };
const LAYER = { baseURL: 'https://api.example.com/v1', apiKey: 'k', model: 'm', voice: 'v', prompt: '' };
const REFLEX = {
  baseURL: 'http://studio:8888/v1', apiKey: 'k', model: 'jev', threshold: 0.8, state: DEFAULT_STATE,
  question: { name: 'action', instructions: 'Is it a move?', options: [
    { choice: 'left', description: 'Turn left.', actions: [{ name: 'move', args: { steps: [{ drive: 'forward', steer: 'left', duration_ms: 600 }] } }] },
    { choice: 'pass', description: 'Anything else.', actions: [] },
  ] },
};

/**
 * The admin API on its own, with a fetch that answers the OpenAI-compatible
 * paths (helpers.js) and /systemone, or fails every request when `status` is set.
 * @param {{ status?: number, llmHangs?: boolean, timeoutMs?: number, lateRefusal?: number }} [opts]
 */
async function rig(opts = {}) {
  const base = fakeFetch({ llmHangs: opts.llmHangs });
  const late = opts.lateRefusal;
  /** @type {any[]} */ const reflexAsked = [];
  const fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (opts.status) return new Response('{"error":{"message":"bad key"}}', { status: opts.status });
    if (late && url.endsWith('/chat/completions')) {
      // Answers after the check's deadline, ignoring the abort, with a refusal.
      await new Promise((r) => setTimeout(r, late));
      return new Response('{"error":{"message":"tools are not supported"}}', { status: 400 });
    }
    if (url.endsWith('/systemone')) {
      reflexAsked.push(JSON.parse(init.body));
      return Response.json({ answers: { action: { choice: 'left', probabilities: { left: 0.95, pass: 0.05 } } } });
    }
    return base(url, init);
  });
  const api = createAdminApi({
    dir: tempCharacters().dir, link: { online: () => [], kick: () => false },
    fetch, checkTimeoutMs: opts.timeoutMs,
  });
  const server = createServer((req, res) => void api(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  /** @param {string} layer @param {any} body @param {Record<string, string>} [headers] */
  const check = async (layer, body, headers = W) => {
    const r = await globalThis.fetch(`http://127.0.0.1:${port}/api/check/${layer}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const type = r.headers.get('content-type') ?? '';
    const out = type.startsWith('audio/') ? new Uint8Array(await r.arrayBuffer()) : await r.json();
    return { status: r.status, type, body: /** @type {any} */ (out) };
  };
  return { check, calls: base.calls, reflexAsked, close: () => server.close() };
}

test('stt: the fixture for the language goes to the configured provider, the transcript comes back', async () => {
  const r = await rig();
  try {
    const out = await r.check('stt', { config: LAYER, lang: 'en' });
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { text: 'go forward a bit' });
    assert.equal(r.calls.filter((c) => c.url.endsWith('/audio/transcriptions')).length, 1);
  } finally { r.close(); }
});

test('llm: chat and tool call, as checkLlm reports them', async () => {
  const r = await rig();
  try {
    const out = await r.check('llm', { config: LAYER, lang: 'zh' });
    assert.equal(out.status, 200);
    assert.match(out.body.text, /move/);
  } finally { r.close(); }
});

test('reflex: heard and robotSaid are passed through', async () => {
  const r = await rig();
  try {
    const out = await r.check('reflex', { config: REFLEX, lang: 'en', heard: 'turn left', robotSaid: 'Okay!' });
    assert.equal(out.status, 200);
    assert.match(out.body.text, /“turn left” → fired/);
    assert.match(JSON.stringify(r.reflexAsked[0]), /Okay!/);
  } finally { r.close(); }
});

test('tts: answers audio/wav of the language line', async () => {
  const r = await rig();
  try {
    const out = await r.check('tts', { config: LAYER, lang: 'zh' });
    assert.equal(out.status, 200);
    assert.equal(out.type, 'audio/wav');
    assert.equal(Buffer.from(out.body.subarray(0, 4)).toString('ascii'), 'RIFF');
    assert.equal(r.calls.find((c) => c.url.endsWith('/audio/speech'))?.body.input, MATERIAL.zh.line);
  } finally { r.close(); }
});

test('a provider failure is a 502 with the provider\'s words', async () => {
  const r = await rig({ status: 401 });
  try {
    for (const layer of ['stt', 'llm', 'tts']) {
      const out = await r.check(layer, { config: LAYER, lang: 'en' });
      assert.equal(out.status, 502, layer);
      assert.match(out.body.error, /401/, layer);
    }
  } finally { r.close(); }
});

test('an unknown layer is a 404, and a POST without X-Bot-Reborn a 403', async () => {
  const r = await rig();
  try {
    assert.equal((await r.check('ears', { config: LAYER })).status, 404);
    assert.equal((await r.check('stt', { config: LAYER }, { 'Content-Type': 'application/json' })).status, 403);
  } finally { r.close(); }
});

test('a provider that never answers times out with a message', async () => {
  const r = await rig({ llmHangs: true, timeoutMs: 50 });
  try {
    const out = await r.check('llm', { config: LAYER, lang: 'en' });
    assert.equal(out.status, 502);
    assert.ok(out.body.error);
  } finally { r.close(); }
});

test('a provider error that lands after the deadline is still shown as itself', async () => {
  // A slow model that then refuses tools: "tools are not supported" is the
  // answer this check exists to give, and "no answer" would hide it.
  const r = await rig({ lateRefusal: 100, timeoutMs: 50 });
  try {
    const out = await r.check('llm', { config: LAYER, lang: 'en' });
    assert.equal(out.status, 502);
    assert.match(out.body.error, /400|tools are not supported/);
  } finally { r.close(); }
});

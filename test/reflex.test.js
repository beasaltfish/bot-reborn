import test from 'node:test';
import assert from 'node:assert/strict';
import { Reflex, shortEnough, buildState, FIRE_AT, TIMEOUT_MS, INSTRUCTIONS } from '../web/reflex.js';

const CFG = { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-test', model: 'jev-1.13' };

test('the constants are the spec\'s', () => {
  assert.equal(FIRE_AT, 0.8);
  assert.equal(TIMEOUT_MS, 1500);
});

test('the instructions keep the rule that protects real replies', () => {
  // Review focus 1: 明白 after 你明白吗 must be a reply. These are the lines
  // that measured 0 false fires on 2026-09-28; editing them re-opens that.
  assert.match(INSTRUCTIONS, /makes no\s+sense as an answer to what the robot said/);
  assert.match(INSTRUCTIONS, /明白, 好的, 嗯嗯, 对对, 哈哈/);
  assert.match(INSTRUCTIONS, /never noises/);
});

test('shortEnough: CJK counts characters, up to six', () => {
  assert.equal(shortEnough('忘忘'), true);
  assert.equal(shortEnough('汪！汪！汪！'), true);           // punctuation not counted
  assert.equal(shortEnough('汪汪汪汪汪汪'), true);
  assert.equal(shortEnough('帮我往前开一米然后左转'), false);
});

test('shortEnough: otherwise words, up to three', () => {
  assert.equal(shortEnough('Woof, woof.'), true);
  assert.equal(shortEnough('woof woof woof'), true);
  assert.equal(shortEnough('please go forward a bit'), false);
  assert.equal(shortEnough('   '), false, 'nothing is not an animal noise');
});

test('buildState: with and without the robot\'s last line', () => {
  assert.equal(buildState('明白', '你明白吗？'), 'Robot said: 「你明白吗？」\nPerson said: 「明白」');
  assert.equal(buildState('忘忘', ''), 'Person said: 「忘忘」');
});

/** @param {any} body @param {number} [status] */
function answering(body, status = 200) {
  /** @type {any[]} */ const seen = [];
  const fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status });
  });
  return { seen, fetch };
}

/** @param {number} p */
const tease = (p) => ({ answers: { intent: { type: 'choice', choice: 'tease',
  probabilities: { tease: p, command: 0, reply: 1 - p } } } });

test('judge: a confident tease fires, and the request is the one we measured', async () => {
  const { seen, fetch } = answering(tease(0.94));
  const v = await new Reflex(CFG, { fetch }).judge('忘忘', '');
  assert.equal(v.verdict, 'fired');
  assert.match(v.detail, /tease 0\.94/);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/systemone');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(seen[0].body.model, 'jev-1.13');
  assert.equal(seen[0].body.state, 'Person said: 「忘忘」');
  assert.equal(seen[0].body.questions.intent.type, 'choice');
  assert.deepEqual(Object.keys(seen[0].body.questions.intent.criteria).sort(),
    ['command', 'reply', 'tease']);
});

test('judge: a tease below 0.8 passes', async () => {
  const { fetch } = answering(tease(0.79));
  assert.equal((await new Reflex(CFG, { fetch }).judge('往往', '')).verdict, 'passed');
});

test('judge: a non-tease choice passes whatever its tease number', async () => {
  const { fetch } = answering({ answers: { intent: { type: 'choice', choice: 'reply',
    probabilities: { tease: 0.85, command: 0, reply: 0.9 } } } });
  assert.equal((await new Reflex(CFG, { fetch }).judge('明白', '你明白吗？')).verdict, 'passed');
});

test('judge: a long transcript is skipped without a request', async () => {
  const { seen, fetch } = answering(tease(1));
  const v = await new Reflex(CFG, { fetch }).judge('帮我往前开一米然后左转', '');
  assert.equal(v.verdict, 'skipped');
  assert.equal(seen.length, 0);
});

test('judge: HTTP errors, bad shapes and throws all fail quietly', async () => {
  for (const fetch of [
    answering({ error: 'no' }, 401).fetch,
    answering({ answers: {} }).fetch,
    async () => { throw new Error('offline'); },
  ]) {
    const v = await new Reflex(CFG, { fetch: /** @type {any} */ (fetch) }).judge('汪汪', '');
    assert.equal(v.verdict, 'failed');
  }
});

test('judge: a slow answer times out as failed', async () => {
  const fetch = (/** @type {string} */ _u, /** @type {any} */ init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const v = await new Reflex(CFG, { fetch: /** @type {any} */ (fetch), timeoutMs: 10 }).judge('汪汪', '');
  assert.equal(v.verdict, 'failed');
  assert.match(v.detail, /timeout/i);
});

test('judge: the caller cancelling aborts the request too', async () => {
  /** @type {any} */ let got = null;
  const fetch = (/** @type {string} */ _u, /** @type {any} */ init) => new Promise((_, reject) => {
    got = init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const ctrl = new AbortController();
  const pending = new Reflex(CFG, { fetch: /** @type {any} */ (fetch) }).judge('汪汪', '', ctrl.signal);
  ctrl.abort();
  const v = await pending;
  assert.equal(v.verdict, 'failed');
  assert.equal(got.aborted, true);
});

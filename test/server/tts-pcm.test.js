import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PcmTts } from '../../server/providers/tts-pcm.js';
import { OpenAiTtsSource } from '../../server/providers/tts-openai.js';
import { encodeWav } from '../../core/providers/stt-openai-compat.js';

const CFG = { baseURL: 'http://tts', apiKey: 'k', model: 'm', voice: 'v' };

function fakeMouth() {
  /** @type {number[]} */ const played = [];
  let hushed = 0;
  /** @type {() => void} */ let finish = () => {};
  return {
    played, get hushed() { return hushed; }, end: () => finish(),
    mouth: /** @type {any} */ ({
      play(/** @type {Int16Array} */ pcm) {
        played.push(pcm.length);
        return { ms: 0, started: Promise.resolve(), done: new Promise((r) => { finish = () => r(undefined); }) };
      },
      hush() { hushed++; finish(); },
    }),
  };
}

const wavResponse = (/** @type {number} */ samples, /** @type {number} */ rate) =>
  new Response(encodeWav(new Int16Array(samples).fill(1000), rate));

test('asks for WAV, resamples to 16 kHz, plays, and resolves when playback ends', async () => {
  /** @type {any} */ let body;
  const m = fakeMouth();
  const tts = new PcmTts(new OpenAiTtsSource(CFG, {
    fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return wavResponse(24000, 24000); },
  }), { mouth: m.mouth });
  let playing = false; let resolved = false;
  const p = tts.speak('hi', { onPlaying: () => { playing = true; } }).then(() => { resolved = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(body.response_format, 'wav');
  assert.deepEqual(m.played, [16000]);
  assert.equal(playing, true);
  assert.equal(resolved, false);
  m.end();
  await p;
  assert.equal(resolved, true);
});

test('MP3 back from a provider is a readable fault, not a crash', async () => {
  const m = fakeMouth();
  const tts = new PcmTts(new OpenAiTtsSource(CFG, {
    fetch: async () => new Response(new TextEncoder().encode('ID3\u0004rest of an mp3')),
  }), { mouth: m.mouth });
  await assert.rejects(tts.speak('hi'), /not WAV/);
  assert.deepEqual(m.played, []);
});

test('an HTTP error names its status', async () => {
  const tts = new PcmTts(new OpenAiTtsSource(CFG, {
    fetch: async () => new Response('no', { status: 401, statusText: 'Unauthorized' }),
  }), { mouth: fakeMouth().mouth });
  await assert.rejects(tts.speak('hi'), /401/);
});

test('cancel during playback hushes the mouth and lets speak resolve', async () => {
  const m = fakeMouth();
  const tts = new PcmTts(new OpenAiTtsSource(CFG, { fetch: async () => wavResponse(1600, 16000) }), { mouth: m.mouth });
  const p = tts.speak('hi');
  await new Promise((r) => setImmediate(r));
  tts.cancel();
  await p;
  assert.equal(m.hushed, 1);
});

test('cancel with nothing playing does not hush someone else\'s beep', () => {
  const m = fakeMouth();
  new PcmTts(new OpenAiTtsSource(CFG, { fetch: async () => wavResponse(1600, 16000) }), { mouth: m.mouth }).cancel();
  assert.equal(m.hushed, 0);
});

test('a caller abort during the request is silent', async () => {
  const ctrl = new AbortController();
  const tts = new PcmTts(new OpenAiTtsSource(CFG, {
    fetch: (_u, init) => new Promise((_, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
  }), { mouth: fakeMouth().mouth });
  const p = tts.speak('hi', { signal: ctrl.signal });
  ctrl.abort();
  await p;
});

test('a provider with an input limit gets the text in sentence-sized pieces, played as one', async () => {
  /** @type {string[]} */ const inputs = [];
  const source = new OpenAiTtsSource(CFG, {
    maxInput: 40,
    fetch: async (_url, init) => { inputs.push(JSON.parse(String(init?.body)).input); return wavResponse(100, 24000); },
  });
  const text = 'The first sentence is here. The second one follows it. And a third.';
  const { samples, rate } = await source.synthesize(text);
  assert.ok(inputs.length > 1);
  assert.ok(inputs.every((s) => s.length <= 40), JSON.stringify(inputs));
  assert.equal(inputs.join(' ').replace(/\s+/g, ' '), text);
  assert.equal(rate, 24000);
  assert.equal(samples.length, 100 * inputs.length);
});

test('a sentence longer than the limit is cut at a space, and a word longer than it is cut anyway', async () => {
  /** @type {string[]} */ const inputs = [];
  const source = new OpenAiTtsSource(CFG, {
    maxInput: 10,
    fetch: async (_url, init) => { inputs.push(JSON.parse(String(init?.body)).input); return wavResponse(10, 24000); },
  });
  await source.synthesize('one two three four supercalifragilistic');
  assert.ok(inputs.every((s) => s.length > 0 && s.length <= 10), JSON.stringify(inputs));
  assert.equal(inputs.join('').replace(/ /g, ''), 'one two three four supercalifragilistic'.replace(/ /g, ''));
});

test('without a limit the text goes in one request', async () => {
  let calls = 0;
  const source = new OpenAiTtsSource(CFG, { fetch: async () => { calls++; return wavResponse(10, 24000); } });
  await source.synthesize('x'.repeat(500));
  assert.equal(calls, 1);
});

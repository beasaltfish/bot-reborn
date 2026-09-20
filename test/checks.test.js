import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHIPPED_CLIP, TTS_CHECK_LINE,
  fetchClip, toInt16Pcm, checkStt, checkLlm, checkTts,
} from '../web/checks.js';

/** @param {{ status?: number, type?: string }} opts */
function response({ status = 200, type = 'audio/wav' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (/** @type {string} */ h) => (h === 'content-type' ? type : null) },
    arrayBuffer: async () => new ArrayBuffer(8),
  };
}

/**
 * Replace globalThis.fetch for one test and put it back afterwards.
 * @param {any} fake
 * @param {() => any} fn
 */
function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = real; });
}

/**
 * A context that "decodes" anything into three samples of one channel. `any`
 * because an AudioContext is a hundred members wide and this uses one of them;
 * the cast is the test saying so out loud rather than pretending otherwise.
 * @type {any}
 */
const ctx = {
  decodeAudioData: async () => ({
    sampleRate: 16000,
    getChannelData: () => new Float32Array([0, 0.5, -0.5]),
  }),
};

test('fetchClip refuses the index.html Cloudflare serves instead of a 404', async () => {
  // Pages answers a missing static path with the SPA shell and status 200.
  // Treating that as found hands decodeAudioData an HTML document, and the
  // decode error it throws says nothing about the clip being absent.
  await withFetch(async () => response({ type: 'text/html; charset=utf-8' }), async () => {
    assert.equal(await fetchClip('fixtures/nope.wav'), null);
  });
});

test('fetchClip refuses a real 404 too', async () => {
  await withFetch(async () => response({ status: 404, type: 'text/plain' }), async () => {
    assert.equal(await fetchClip('fixtures/nope.wav'), null);
  });
});

test('fetchClip returns a genuine wav', async () => {
  await withFetch(async () => response(), async () => {
    assert.notEqual(await fetchClip(SHIPPED_CLIP), null);
  });
});

test('toInt16Pcm uses the full negative range and clamps out of range input', () => {
  const { pcm, sampleRate } = toInt16Pcm(/** @type {any} */ ({
    sampleRate: 16000,
    getChannelData: () => new Float32Array([0, -1, 1, -2, 2]),
  }));
  assert.equal(sampleRate, 16000);
  assert.equal(pcm[0], 0);
  assert.equal(pcm[1], -32768);
  assert.equal(pcm[2], 32767);
  // Anything a decoder hands back beyond ±1 has to clamp, not wrap: wrapping
  // turns a loud sample into a loud sample of the opposite sign, which is a
  // click the transcript then has to survive.
  assert.equal(pcm[3], -32768);
  assert.equal(pcm[4], 32767);
});

test('checkStt says the clip is missing rather than failing to decode it', async () => {
  await withFetch(async () => response({ type: 'text/html' }), async () => {
    await assert.rejects(
      () => checkStt({ transcribe: async () => 'anything' }, ctx),
      /missing from this deployment/);
  });
});

test('checkStt treats an empty transcript as a failure', async () => {
  // A key with the wrong scope is accepted and answers with nothing. Reporting
  // that as a pass sends somebody off to debug a microphone that is fine.
  await withFetch(async () => response(), async () => {
    await assert.rejects(
      () => checkStt({ transcribe: async () => '   ' }, ctx),
      /came back empty/);
  });
});

test('checkStt returns the transcript when there is one', async () => {
  await withFetch(async () => response(), async () => {
    assert.equal(await checkStt({ transcribe: async () => ' hello ' }, ctx), 'hello');
  });
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

test('checkTts speaks the line that contains both languages', async () => {
  // A voice that can only read one of them fails silently otherwise: it reads
  // the half it knows and sounds perfectly fine doing it.
  let spoken = null;
  const out = await checkTts({ speak: async (text) => { spoken = text; } });
  assert.equal(spoken, TTS_CHECK_LINE);
  assert.equal(out, TTS_CHECK_LINE);
  assert.match(TTS_CHECK_LINE, /[一-鿿]/);
  assert.match(TTS_CHECK_LINE, /[a-z]/i);
});

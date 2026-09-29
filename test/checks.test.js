import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MATERIAL,
  fetchClip, toInt16Pcm, checkStt, checkLlm, checkTts, checkReflex,
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
    assert.notEqual(await fetchClip(MATERIAL.zh.clip), null);
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

test('checkTts speaks the line for the language it was given', async () => {
  for (const lang of /** @type {const} */ (['en', 'zh'])) {
    let spoken = null;
    const out = await checkTts({ speak: async (text) => { spoken = text; } }, lang);
    assert.equal(spoken, MATERIAL[lang].line);
    assert.equal(out, MATERIAL[lang].line);
  }
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

test('checkStt reads the clip belonging to the language it was given', async () => {
  /** @type {string[]} */
  const asked = [];
  await withFetch(async (/** @type {string} */ path) => {
    asked.push(path);
    return response();
  }, async () => {
    await checkStt({ transcribe: async () => 'ok' }, ctx, 'en');
    await checkStt({ transcribe: async () => 'ok' }, ctx, 'zh');
  });
  assert.deepEqual(asked, [MATERIAL.en.clip, MATERIAL.zh.clip]);
});

test('checkReflex passes a key that gets a verdict, and says which', async () => {
  const reflex = { judge: async () => ({ verdict: 'fired', detail: 'tease 0.99', ms: 600 }) };
  assert.equal(await checkReflex(reflex), '“woof woof” → fired (tease 0.99, 600 ms)');
});

test('checkReflex fails when no verdict came back', async () => {
  // judge() never rejects; `failed` is how a bad key or a timeout arrives.
  const reflex = { judge: async () => ({ verdict: 'failed', detail: 'HTTP 401', ms: 300 }) };
  await assert.rejects(() => checkReflex(reflex), /HTTP 401 after 300 ms/);
});

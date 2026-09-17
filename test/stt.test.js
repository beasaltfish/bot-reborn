import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAiCompatStt, encodeWav, BILINGUAL_PROMPT, summariseSegments,
} from '../web/providers/stt-openai-compat.js';

const CFG = { baseURL: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'whisper-large-v3-turbo' };

test('encodeWav(): writes a 44-byte header followed by the samples', () => {
  const pcm = Int16Array.from([0, 1, -1, 32767, -32768]);
  const buf = encodeWav(pcm, 16000);
  const view = new DataView(buf);
  /** @param {number} o */
  const ascii = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));

  assert.equal(buf.byteLength, 44 + pcm.length * 2);
  assert.equal(ascii(0), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + pcm.length * 2);
  assert.equal(ascii(8), 'WAVE');
  assert.equal(ascii(12), 'fmt ');
  assert.equal(view.getUint32(16, true), 16);          // PCM fmt chunk size
  assert.equal(view.getUint16(20, true), 1);           // format = PCM
  assert.equal(view.getUint16(22, true), 1);           // mono
  assert.equal(view.getUint32(24, true), 16000);       // sample rate
  assert.equal(view.getUint32(28, true), 16000 * 2);   // byte rate
  assert.equal(view.getUint16(32, true), 2);           // block align
  assert.equal(view.getUint16(34, true), 16);          // bits per sample
  assert.equal(ascii(36), 'data');
  assert.equal(view.getUint32(40, true), pcm.length * 2);
  assert.equal(view.getInt16(44 + 6, true), 32767);
  assert.equal(view.getInt16(44 + 8, true), -32768);
});

/** @param {any} [body] @param {number} [status] */
function captureFetch(body = { text: '往前走' }, status = 200) {
  /** @type {any} */
  const seen = {};
  /** @param {any} url @param {any} init */
  const fetchImpl = async (url, init) => {
    seen.url = url;
    seen.headers = init.headers;
    seen.form = init.body;
    return new Response(JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json' },
    });
  };
  return { seen, fetchImpl };
}

test('transcribe(): posts multipart to /audio/transcriptions and returns the text', async () => {
  const { seen, fetchImpl } = captureFetch();
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl });
  const text = await stt.transcribe(Int16Array.from([1, 2, 3]), 16000);

  assert.equal(text, '往前走');
  assert.equal(seen.url, 'https://api.example.com/v1/audio/transcriptions');
  assert.equal(seen.headers.Authorization, 'Bearer sk-test');
  assert.equal(seen.form.get('model'), 'whisper-large-v3-turbo');
});

test('transcribe(): NEVER sends `language` (spec §11.1)', async () => {
  // Sending it forces the decoder's language token. Guessing wrong is not
  // "slightly worse output", it is a systematic failure for a whole language.
  const { seen, fetchImpl } = captureFetch();
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl });
  await stt.transcribe(Int16Array.from([1]), 16000);
  assert.equal(seen.form.get('language'), null);
  assert.equal(seen.form.has('language'), false);
});

test('transcribe(): DOES send a bilingual prompt, and it reads like a sentence', async () => {
  const { seen, fetchImpl } = captureFetch();
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl });
  await stt.transcribe(Int16Array.from([1]), 16000);

  assert.equal(seen.form.get('prompt'), BILINGUAL_PROMPT);
  // Spec §11.1: the prompt can leak into the transcript, so it must be short
  // and phrased as an ordinary sentence, never as an instruction.
  assert.ok(BILINGUAL_PROMPT.length < 60, 'prompt should be short');
  assert.ok(/[一-鿿]/.test(BILINGUAL_PROMPT), 'prompt should contain Chinese');
  assert.ok(/[A-Za-z]/.test(BILINGUAL_PROMPT), 'prompt should contain English');
});

test('transcribe(): a trimmed-empty transcript comes back as an empty string', async () => {
  const { fetchImpl } = captureFetch({ text: '   \n ' });
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl });
  assert.equal(await stt.transcribe(Int16Array.from([1]), 16000), '');
});

test('transcribe(): an HTTP error throws with the status in the message', async () => {
  const { fetchImpl } = captureFetch({ error: 'nope' }, 401);
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl });
  await assert.rejects(() => stt.transcribe(Int16Array.from([1]), 16000), /401/);
});

test('transcribe(): a hung request aborts at timeoutMs', async () => {
  // Spec §6.7: all three providers need the same 15 s net. Without it the
  // voice loop has no recovery path — STT just never comes back.
  /** @param {any} url @param {any} init */
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl, timeoutMs: 20 });
  await assert.rejects(
    () => stt.transcribe(Int16Array.from([1]), 16000),
    (/** @type {any} */ err) => err.name === 'AbortError');
});

test("transcribe(): the caller's signal aborts a request still in flight", async () => {
  /** @param {any} url @param {any} init */
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const stt = new OpenAiCompatStt(CFG, { fetch: fetchImpl, timeoutMs: 60_000 });
  const controller = new AbortController();

  const job = stt.transcribe(Int16Array.from([1]), 16000, { signal: controller.signal });
  controller.abort();

  const outcome = await Promise.race([
    job.then(() => 'resolved', (/** @type {any} */ err) => err.name),
    new Promise((r) => setTimeout(() => r('still pending'), 50)),
  ]);
  assert.equal(outcome, 'AbortError');
});

// --- verbose_json: the second axis -----------------------------------------

test('summariseSegments(): no segments at all reads as unknown, not as zero', () => {
  // Groq is OpenAI-compatible, not OpenAI. If it answers verbose_json without
  // a segments array, the honest reading is "this endpoint did not say", and a
  // 0 would read as "definitely speech" — the most dangerous direction to
  // guess in, since 0 is the value that lets everything through.
  assert.deepEqual(summariseSegments(undefined), { noSpeech: null, logprob: null, parts: 0 });
  assert.deepEqual(summariseSegments([]), { noSpeech: null, logprob: null, parts: 0 });
});

test('summariseSegments(): one segment reports its own numbers', () => {
  const s = summariseSegments([{ no_speech_prob: 0.91, avg_logprob: -0.8 }]);
  assert.deepEqual(s, { noSpeech: 0.91, logprob: -0.8, parts: 1 });
});

test('summariseSegments(): several segments report the worst of each', () => {
  // Worst, not mean: the instrument exists to show the number a threshold
  // would trip on. `parts` is on the line so that a reading driven by one bad
  // slice of a long clip is visible as such rather than read as the whole.
  const s = summariseSegments([
    { no_speech_prob: 0.02, avg_logprob: -0.3 },
    { no_speech_prob: 0.88, avg_logprob: -1.4 },
    { no_speech_prob: 0.40, avg_logprob: -0.9 },
  ]);
  assert.deepEqual(s, { noSpeech: 0.88, logprob: -1.4, parts: 3 });
});

test('summariseSegments(): a segment missing the fields does not poison the rest', () => {
  const s = summariseSegments([{ no_speech_prob: 0.5, avg_logprob: -0.5 }, { text: 'hi' }]);
  assert.deepEqual(s, { noSpeech: 0.5, logprob: -0.5, parts: 2 });
});

test('transcribeDetailed(): asks for verbose_json, plain transcribe() does not', () => {
  const verbose = captureFetch({ text: 'x', segments: [] });
  void new OpenAiCompatStt(CFG, { fetch: verbose.fetchImpl })
    .transcribeDetailed(Int16Array.from([1]), 16000);
  const plain = captureFetch({ text: 'x' });
  void new OpenAiCompatStt(CFG, { fetch: plain.fetchImpl })
    .transcribe(Int16Array.from([1]), 16000);
  return Promise.resolve().then(() => {
    assert.equal(verbose.seen.form.get('response_format'), 'verbose_json');
    assert.equal(plain.seen.form.get('response_format'), null);
  });
});

test('transcribeDetailed(): hands back the text and both numbers', async () => {
  const { fetchImpl } = captureFetch({
    text: '  谢谢大家。 ',
    segments: [{ no_speech_prob: 0.97, avg_logprob: -1.1 }],
  });
  const got = await new OpenAiCompatStt(CFG, { fetch: fetchImpl })
    .transcribeDetailed(Int16Array.from([1, 2]), 16000);
  assert.deepEqual(got, { text: '谢谢大家。', noSpeech: 0.97, logprob: -1.1, parts: 1 });
});

test('transcribeDetailed(): still sends the bilingual prompt', async () => {
  // §11.1 is not suspended by asking for more fields back.
  const { seen, fetchImpl } = captureFetch({ text: 'x', segments: [] });
  await new OpenAiCompatStt(CFG, { fetch: fetchImpl })
    .transcribeDetailed(Int16Array.from([1]), 16000);
  assert.equal(seen.form.get('prompt'), BILINGUAL_PROMPT);
  assert.equal(seen.form.get('language'), null);
});

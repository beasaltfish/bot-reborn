import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiCompatStt, encodeWav, BILINGUAL_PROMPT } from '../web/providers/stt-openai-compat.js';

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

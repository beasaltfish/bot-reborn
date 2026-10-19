// STT over Volcengine's flash recording recogniser (豆包语音, 极速版).
// Volcengine voice spec §4.1: the same interface as OpenAiCompatStt, so
// session.js cannot tell which one it holds.
//
// One request, the whole clip as base64 WAV inside JSON, the transcript in
// the answer. The endpoint and field names come from the docs as read on
// 2026-10-18 and are to be confirmed with a real key (spec §5.2).
//
// The verdict is in a header, not in the HTTP status: a 200 can still carry a
// failure, and reading only `response.ok` would turn that into an empty
// transcript — the robot going "huh?" at a broken key.

import { encodeWav } from './stt-openai-compat.js';
import { requestError } from './request-error.js';

const PATH = '/api/v3/auc/bigmodel/recognize/flash';
const OK = '20000000';
/** Silent audio: nothing to transcribe, which is an answer, not a fault. */
const SILENCE = '20000003';

/** Spec §6.7: the same 15 s net as every other provider. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** @param {ArrayBuffer} buffer */
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  // Chunked: String.fromCharCode(...bytes) overflows the stack on a long clip.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export class VolcengineStt {
  #cfg; #fetch; #timeoutMs;

  /**
   * `prompt` is accepted and not sent: whether Volcengine's context field
   * steers wording the way a Whisper prompt does is unmeasured (spec §5.2).
   * @param {{ baseURL: string, apiKey: string, model: string, prompt?: string }} cfg
   * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<string>}
   */
  async transcribe(pcm, sampleRate, opts = {}) {
    return (await this.transcribeDetailed(pcm, sampleRate, opts)).text;
  }

  /**
   * No confidence numbers come back, so both are null — "the endpoint did not
   * say", which session.js already lets through.
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<{ text: string, noSpeech: null, logprob: null, parts: number }>}
   */
  async transcribeDetailed(pcm, sampleRate, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    try {
      const response = await this.#fetch(`${this.#cfg.baseURL.replace(/\/+$/, '')}${PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.#cfg.apiKey,
          'X-Api-Resource-Id': this.#cfg.model,
          'X-Api-Request-Id': crypto.randomUUID(),
          'X-Api-Sequence': '-1',
        },
        body: JSON.stringify({
          user: { uid: 'bot-reborn' },
          audio: { data: base64(encodeWav(pcm, sampleRate)) },
          request: { model_name: 'bigmodel' },
        }),
        signal,
      });
      if (!response.ok) throw await requestError('STT', response);
      const code = response.headers.get('X-Api-Status-Code') ?? OK;
      if (code === SILENCE) return { text: '', noSpeech: null, logprob: null, parts: 0 };
      if (code !== OK) {
        throw new Error(`Volcengine STT ${code}: ${response.headers.get('X-Api-Message') ?? 'no message'}`);
      }
      const json = await response.json();
      return { text: (json?.result?.text ?? '').trim(), noSpeech: null, logprob: null, parts: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}

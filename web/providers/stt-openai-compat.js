// STT over the OpenAI-compatible /v1/audio/transcriptions endpoint.
// Spec §8.1 interface: transcribe(pcm, sampleRate) → text.

/**
 * Spec §11.1. Two different things are often lumped together as "hints":
 *
 *   `language` — FORCES the decoder's language token. We never send it.
 *   `prompt`   — steers context and vocabulary WITHOUT locking the language.
 *
 * This one is deliberately short and phrased as an ordinary sentence, because
 * models occasionally continue the prompt into the transcript. Never write it
 * as an instruction.
 */
export const BILINGUAL_PROMPT = '这是一段关于开车和 English learning 的对话。';

/**
 * Fold verbose_json's per-slice numbers into one reading.
 *
 * Whisper cuts a clip into its own slices and reports both numbers per slice.
 * This keeps the WORST of each — the number a threshold would trip on — and
 * carries `parts` alongside, so a reading driven by one bad slice of a long
 * clip is visible as that rather than read as a verdict on the whole.
 *
 * Absent segments give null, never 0: Groq is OpenAI-compatible, not OpenAI,
 * and "this endpoint did not say" must not arrive looking like "definitely
 * speech" — 0 is the value that lets everything through.
 *
 * @param {Array<{ no_speech_prob?: number, avg_logprob?: number,
 *                 [key: string]: unknown }>} [segments] whisper sends a dozen
 *   fields per slice — id, seek, start, end, text, tokens — and this reads two.
 * @returns {{ noSpeech: number | null, logprob: number | null, parts: number }}
 */
export function summariseSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { noSpeech: null, logprob: null, parts: 0 };
  }
  /** @param {(number | undefined)[]} xs @param {(a: number, b: number) => number} pick */
  const worst = (xs, pick) => {
    const ns = xs.filter((x) => typeof x === 'number');
    // `reduce(pick)` would hand Math.max the index and the array as well, and
    // Math.max(0.4, 1, [..]) is NaN. Two arguments, deliberately.
    return ns.length ? ns.reduce((a, b) => pick(a, b)) : null;
  };
  return {
    noSpeech: worst(segments.map((s) => s.no_speech_prob), Math.max),
    logprob: worst(segments.map((s) => s.avg_logprob), Math.min),
    parts: segments.length,
  };
}

/**
 * @param {Int16Array} pcm
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
export function encodeWav(pcm, sampleRate) {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const ascii = (/** @type {number} */ offset, /** @type {string} */ text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);            // PCM header length
  view.setUint16(20, 1, true);             // format: PCM
  view.setUint16(22, 1, true);             // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  new Int16Array(buffer, 44).set(pcm);
  return buffer;
}

/** Spec §6.7: the same 15 s net as the other two providers. */
const DEFAULT_TIMEOUT_MS = 15_000;

export class OpenAiCompatStt {
  #cfg;
  #fetch;
  #timeoutMs;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string }} cfg
   * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Spec §8.1's interface, unchanged: pcm in, text out.
   *
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<string>}
   */
  async transcribe(pcm, sampleRate, opts = {}) {
    const json = await this.#post(pcm, sampleRate, null, opts.signal);
    return (json.text ?? '').trim();
  }

  /**
   * The same call, the same money, more fields in the answer.
   *
   * Whisper always computes a probability for its own `<|nospeech|>` token; the
   * default response format simply does not return it. That number is a SECOND
   * axis, independent of level: loudness is measured off the audio, this is the
   * model's own opinion of whether there was anything to transcribe. Handed an
   * empty room it does not answer with silence — it answers with 「谢谢大家」,
   * or with BILINGUAL_PROMPT above continued into the transcript, and both of
   * those read exactly like a transcript from the outside.
   *
   * Nothing filters on it yet, on purpose. Where the threshold belongs is a
   * measurement nobody has taken, and the same run that takes it needs the
   * false positives still coming through so their numbers can be read off.
   *
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<{ text: string } & ReturnType<typeof summariseSegments>>}
   */
  async transcribeDetailed(pcm, sampleRate, opts = {}) {
    const json = await this.#post(pcm, sampleRate, 'verbose_json', opts.signal);
    return { text: (json.text ?? '').trim(), ...summariseSegments(json.segments) };
  }

  /**
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {string | null} responseFormat
   * @param {AbortSignal} [callerSignal]
   * @returns {Promise<any>}
   */
  async #post(pcm, sampleRate, responseFormat, callerSignal) {
    const form = new FormData();
    form.append('file', new Blob([encodeWav(pcm, sampleRate)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.#cfg.model);
    form.append('prompt', BILINGUAL_PROMPT);
    if (responseFormat) form.append('response_format', responseFormat);
    // Deliberately no `language` — spec §11.1.

    const opts = { signal: callerSignal };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    // Either reason to give up must reach the request: the caller cancelling
    // the turn (spec §8.1) or our own deadline (§6.7).
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal;
    try {
      const response = await this.#fetch(`${this.#cfg.baseURL}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#cfg.apiKey}` },
        body: form,
        signal,
      });
      if (!response.ok) {
        throw new Error(`STT request failed: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

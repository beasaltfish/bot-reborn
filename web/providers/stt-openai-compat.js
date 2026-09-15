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
   * @param {Int16Array} pcm
   * @param {number} sampleRate
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<string>}
   */
  async transcribe(pcm, sampleRate, opts = {}) {
    const form = new FormData();
    form.append('file', new Blob([encodeWav(pcm, sampleRate)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.#cfg.model);
    form.append('prompt', BILINGUAL_PROMPT);
    // Deliberately no `language` — spec §11.1.

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
      const json = await response.json();
      return (json.text ?? '').trim();
    } finally {
      clearTimeout(timer);
    }
  }
}

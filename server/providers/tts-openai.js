// The audio half of TTS over the OpenAI-compatible /audio/speech endpoint.
// Playback is PcmTts's (tts-pcm.js); this only turns text into samples.
//
// WAV is asked for because it is the one format every listed provider can
// send that needs no decoder here.
//
// A provider with an input limit (preset `maxInput`, e.g. Groq's 200
// characters) gets the reply in sentence-sized pieces, one after another, and
// the audio comes back joined: refusing a long reply would leave the robot mute.

import { isWav, parseWav } from '../audio/pcm.js';
import { requestError } from '../../core/providers/request-error.js';

/**
 * Sentences packed into pieces of at most `max` characters. A sentence longer
 * than that is cut at the last space that fits, and a word longer still is
 * cut where it must be.
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
export function splitForSpeech(text, max) {
  const clean = text.trim();
  if (clean.length <= max) return clean ? [clean] : [];
  /** @type {string[]} */ const pieces = [];
  /** @param {string} s */
  const cut = (s) => {
    while (s.length > max) {
      const space = s.lastIndexOf(' ', max);
      const at = space > 0 ? space : max;
      pieces.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    return s;
  };
  let current = '';
  for (const sentence of clean.match(/[^.!?。！？]+[.!?。！？]*/g) ?? [clean]) {
    const s = sentence.trim();
    if (!s) continue;
    const joined = current ? `${current} ${s}` : s;
    if (joined.length <= max) { current = joined; continue; }
    if (current) pieces.push(current);
    current = cut(s);
  }
  if (current) pieces.push(current);
  return pieces;
}

export class OpenAiTtsSource {
  #cfg; #fetch; #maxInput;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string, voice: string }} cfg
   * @param {{ fetch?: typeof fetch, maxInput?: number | null }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxInput = opts.maxInput ?? null;
  }

  /**
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<{ samples: Float32Array, rate: number }>}
   */
  async synthesize(text, opts = {}) {
    if (!this.#maxInput || text.length <= this.#maxInput) return this.#one(text, opts);
    /** @type {{ samples: Float32Array, rate: number }[]} */ const parts = [];
    for (const piece of splitForSpeech(text, this.#maxInput)) parts.push(await this.#one(piece, opts));
    if (parts.some((p) => p.rate !== parts[0].rate)) throw new Error('TTS answered the pieces of one reply at different sample rates');
    const samples = new Float32Array(parts.reduce((n, p) => n + p.samples.length, 0));
    let at = 0;
    for (const p of parts) { samples.set(p.samples, at); at += p.samples.length; }
    return { samples, rate: parts[0]?.rate ?? 24000 };
  }

  /**
   * @param {string} text
   * @param {{ signal?: AbortSignal }} opts
   * @returns {Promise<{ samples: Float32Array, rate: number }>}
   */
  async #one(text, opts) {
    const response = await this.#fetch(`${this.#cfg.baseURL}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#cfg.apiKey}` },
      body: JSON.stringify({
        model: this.#cfg.model, voice: this.#cfg.voice, input: text, response_format: 'wav',
      }),
      signal: opts.signal,
    });
    if (!response.ok) throw await requestError('TTS', response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A provider that ignores response_format sends MP3. Saying so here is
    // the difference between "fix the provider" and "the robot is mute".
    if (!isWav(bytes)) throw new Error('TTS returned audio that is not WAV — this provider must support response_format "wav"');
    const wav = parseWav(bytes);
    return { samples: wav.samples, rate: wav.rate };
  }
}

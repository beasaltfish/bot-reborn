// The audio half of TTS over the OpenAI-compatible /audio/speech endpoint.
// Playback is PcmTts's (tts-pcm.js); this only turns text into samples.
//
// WAV is asked for because it is the one format every listed provider can
// send that needs no decoder here.

import { isWav, parseWav } from '../audio/pcm.js';
import { requestError } from '../../core/providers/request-error.js';

export class OpenAiTtsSource {
  #cfg; #fetch;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string, voice: string }} cfg
   * @param {{ fetch?: typeof fetch }} [opts]
   */
  constructor(cfg, opts = {}) {
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<{ samples: Float32Array, rate: number }>}
   */
  async synthesize(text, opts = {}) {
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

// The audio half of TTS over Volcengine's speech synthesis (豆包语音合成 2.0).
// Volcengine voice spec §4.2. Playback is PcmTts's.
//
// The answer is a run of JSON lines, each carrying a base64 slice of the
// audio, ending in a line with the final status. No streaming playback this
// round (spec §1), so every slice is collected before anything is played.
// 16 kHz PCM is asked for so nothing needs resampling or decoding.

import { RATE } from '../../core/protocol.js';
import { bytesToFloat32 } from '../audio/pcm.js';
import { requestError } from '../../core/providers/request-error.js';

// The docs read on 2026-10-18 named two HTTP paths, this one and
// /api/v3/tts/create. Which one answers is for a real key to settle (spec §5.2).
const PATH = '/api/v3/tts/unidirectional';
const DONE = 20000000;

export class VolcengineTtsSource {
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
    const response = await this.#fetch(`${this.#cfg.baseURL.replace(/\/+$/, '')}${PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.#cfg.apiKey,
        'X-Api-Resource-Id': this.#cfg.model,
        'X-Api-Request-Id': crypto.randomUUID(),
      },
      body: JSON.stringify({
        user: { uid: 'bot-reborn' },
        req_params: { text, speaker: this.#cfg.voice, audio_params: { format: 'pcm', sample_rate: RATE } },
      }),
      signal: opts.signal,
    });
    if (!response.ok) throw await requestError('TTS', response);

    /** @type {Buffer[]} */ const chunks = [];
    for (const line of (await response.text()).split('\n')) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.code !== 0 && msg.code !== DONE) {
        throw new Error(`Volcengine TTS ${msg.code}: ${msg.message ?? 'no message'}`);
      }
      if (msg.data) chunks.push(Buffer.from(msg.data, 'base64'));
    }
    // A 200 with nothing in it would play as silence, and a mute robot reads
    // as a broken speaker rather than a refused voice.
    if (chunks.length === 0) throw new Error('Volcengine TTS answered with no audio');
    return { samples: bytesToFloat32(new Uint8Array(Buffer.concat(chunks))), rate: RATE };
  }
}

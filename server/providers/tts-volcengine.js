// The audio half of TTS over Volcengine's speech synthesis (豆包语音合成 2.0).
// Volcengine voice spec §4.2. Playback is PcmTts's.
//
// The answer is HTTP chunked: a run of JSON lines, each carrying a base64
// slice of the audio. HTTP itself says when the last chunk has arrived —
// response.text() resolves only then, and rejects on a cut connection — so no
// end-of-stream line is needed. No streaming playback this round (spec §1):
// every slice is collected before anything is played.
// 16 kHz PCM is asked for so nothing needs resampling or decoding.

import { RATE } from '../../core/protocol.js';
import { bytesToFloat32 } from '../audio/pcm.js';
import { requestError } from '../../core/providers/request-error.js';

// The unidirectional streaming endpoint, as documented 2026-10-19.
const PATH = '/api/v3/tts/unidirectional';
// The docs say 0 is success and anything else a failure. 20000000 is the
// "finished" code of Volcengine's other v3 protocols; it is let through in
// case a closing line carries it, because refusing it would fail a whole
// sentence that had already arrived. Undocumented here — the real-key test
// settles whether it ever appears.
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

// TTS over the OpenAI-compatible /audio/speech endpoint, played through a
// body's speaker instead of this machine's.
//
// Same interface as WebAudioTts, because session.js and brain.js are built
// against it: speak() resolves when playback ends, onPlaying fires when the
// first sample is due, cancel() silences. WAV is asked for because it is the
// one format every listed provider can send that needs no decoder here.

import { RATE } from '../../web/protocol.js';
import { toInt16 } from '../../web/audio/pcm.js';
import { isWav, parseWav, resample } from '../audio/pcm.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export class PcmTts {
  #cfg; #fetch; #mouth; #timeoutMs;
  #epoch = 0;
  /** Whether a clip of OURS is on the mouth — see cancel(). */
  #playing = false;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string, voice: string }} cfg
   * @param {{ mouth: import('../body/mouth.js').Mouth, fetch?: typeof fetch, timeoutMs?: number }} opts
   */
  constructor(cfg, opts) {
    this.#cfg = cfg;
    this.#mouth = opts.mouth;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * @param {string} text
   * @param {{ signal?: AbortSignal, onPlaying?: () => void }} [opts]
   */
  async speak(text, opts = {}) {
    this.cancel();
    const epoch = ++this.#epoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    /** @type {Int16Array} */ let pcm;
    try {
      const response = await this.#fetch(`${this.#cfg.baseURL}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#cfg.apiKey}` },
        body: JSON.stringify({
          model: this.#cfg.model, voice: this.#cfg.voice, input: text, response_format: 'wav',
        }),
        signal,
      });
      if (!response.ok) throw new Error(`TTS request failed: ${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A provider that ignores response_format sends MP3. Saying so here is
      // the difference between "fix the provider" and "the robot is mute".
      if (!isWav(bytes)) throw new Error('TTS returned audio that is not WAV — this provider must support response_format "wav"');
      const wav = parseWav(bytes);
      pcm = toInt16(resample(wav.samples, wav.rate, RATE));
    } catch (err) {
      if (opts.signal?.aborted) return;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (epoch !== this.#epoch) return;

    const clip = this.#mouth.play(pcm);
    this.#playing = true;
    await clip.started;
    if (epoch === this.#epoch) opts.onPlaying?.();
    await clip.done;
    if (epoch === this.#epoch) this.#playing = false;
  }

  /**
   * Only hushes when one of our clips is out. speak() calls this first thing,
   * and brain.js plays the `done` beep right before speaking: an
   * unconditional hush would eat that beep on every turn.
   */
  cancel() {
    this.#epoch++;
    if (!this.#playing) return;
    this.#playing = false;
    this.#mouth.hush();
  }
}

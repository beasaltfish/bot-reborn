// TTS played through a body's speaker instead of this machine's.
//
// Same interface as WebAudioTts, because session.js and brain.js are built
// against it: speak() resolves when playback ends, onPlaying fires when the
// first sample is due, cancel() silences. Where the audio comes from is a
// source's business (tts-openai.js, tts-volcengine.js; picked in pick.js) —
// this half is the same for every provider.

import { RATE } from '../../core/protocol.js';
import { toInt16 } from '../../core/audio/pcm.js';
import { resample } from '../audio/pcm.js';

/**
 * @typedef {{ synthesize(text: string, opts?: { signal?: AbortSignal }):
 *   Promise<{ samples: Float32Array, rate: number }> }} TtsSource
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export class PcmTts {
  #source; #mouth; #timeoutMs;
  #epoch = 0;
  /** Whether a clip of OURS is on the mouth — see cancel(). */
  #playing = false;

  /**
   * @param {TtsSource} source
   * @param {{ mouth: import('../body/mouth.js').Mouth, timeoutMs?: number }} opts
   */
  constructor(source, opts) {
    this.#source = source;
    this.#mouth = opts.mouth;
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
      const audio = await this.#source.synthesize(text, { signal });
      pcm = toInt16(resample(audio.samples, audio.rate, RATE));
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

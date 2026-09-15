// TTS over the OpenAI-compatible /v1/audio/speech endpoint.
//
// The provider plays the audio itself (spec §8.1), through WebAudio rather
// than <audio>, for three reasons (§7.1):
//   1. a 10 ms fade-out on cancel, so barge-in does not pop      ← used in v1
//   2. an AnalyserNode to read the output level                  ← used by §7.3
//   3. createMediaStreamDestination() for the future loopback path ← v1 leaves
//      the seam and does not use it (§7.2)

const FADE_MS = 10;

/** Spec §6.7: the same 15 s net as the other two providers. */
const DEFAULT_TIMEOUT_MS = 15_000;

export class WebAudioTts {
  #cfg;
  #fetch;
  #ctx;
  #gain;
  #analyser;
  /** @type {AudioBufferSourceNode | null} */ #source = null;
  /** @type {(() => void) | null} */ #finish = null;

  /**
   * Which speak() owns the output right now.
   *
   * `#source` alone cannot answer that: between the fetch and `source.start()`
   * there is no source at all, and §7.1 says that window is 1–2 s of silence
   * for a long reply. The same counter the executor uses for the same class of
   * problem (spec §4.5) — bumped by cancel() and by every speak() — makes that
   * window cancellable and makes two overlapping speak() calls resolve to the
   * later one instead of both playing.
   */
  #epoch = 0;
  #timeoutMs;

  /**
   * @param {{ baseURL: string, apiKey: string, model: string, voice: string }} cfg
   * @param {{ audioContext?: AudioContext, loopback?: boolean, fetch?: typeof fetch, timeoutMs?: number }} [opts]
   */
  constructor(cfg, opts = {}) {
    if (opts.loopback) {
      // Spec §7.2: `ttsPath` keeps three legal values but v1 never produces
      // 'loopback'. Shipping an untested fallback path is a liability; the
      // seam is here so adding it later is an edit inside this file.
      throw new Error('the loopback path is not implemented in v1 (spec §7.2)');
    }
    this.#cfg = cfg;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#ctx = opts.audioContext ?? new AudioContext();
    this.#gain = this.#ctx.createGain();
    this.#analyser = this.#ctx.createAnalyser();
    this.#gain.connect(this.#analyser);
    this.#analyser.connect(this.#ctx.destination);
  }

  get analyser() { return this.#analyser; }

  /**
   * Resolves when playback finishes, or immediately when cancelled.
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<void>}
   */
  async speak(text, opts = {}) {
    this.cancel();
    const epoch = ++this.#epoch;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal;
    try {
      return await this.#send(text, epoch, signal);
    } catch (err) {
      // The caller cancelling the turn is not a failure: cancel() resolves
      // too, and brain.js turns a rejection into an `error` earcon — telling
      // the user something broke when they are the one who stopped it. Our
      // own deadline (spec §6.7) still throws, which is why this asks whose
      // signal fired instead of just matching on AbortError.
      if (opts.signal?.aborted) return;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} text
   * @param {number} epoch
   * @param {AbortSignal} signal
   * @returns {Promise<void>}
   */
  async #send(text, epoch, signal) {
    const response = await this.#fetch(`${this.#cfg.baseURL}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#cfg.apiKey}`,
      },
      // Spec §8.2: /v1/audio/speech takes only a plain-text `input`. That is
      // the price of provider portability — no phoneme markup, no voice
      // cloning. And `voice` is a stored config value, never computed from the
      // text: spec §11.1 fixes ONE multilingual voice and does no CJK sniffing,
      // because the sentence that matters most is the mixed one.
      body: JSON.stringify({ model: this.#cfg.model, voice: this.#cfg.voice, input: text }),
      signal,
    });
    // Cancelled (or superseded) while the request was in flight: drop it on the
    // floor. Not even the HTTP error is worth raising — nobody is waiting for
    // this audio any more.
    if (epoch !== this.#epoch) return;
    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status} ${response.statusText}`);
    }

    const buffer = await this.#ctx.decodeAudioData(await response.arrayBuffer());
    if (epoch !== this.#epoch) return;
    if (this.#ctx.state === 'suspended') await this.#ctx.resume();
    if (epoch !== this.#epoch) return;

    return new Promise((resolve) => {
      const source = this.#ctx.createBufferSource();
      source.buffer = buffer;
      this.#gain.gain.setValueAtTime(1, this.#ctx.currentTime);
      source.connect(this.#gain);
      source.onended = () => { if (this.#source === source) this.#clear(); resolve(); };
      this.#source = source;
      this.#finish = resolve;
      source.start();
    });
  }

  /** Fade out over FADE_MS and stop. Safe to call when nothing is playing. */
  cancel() {
    // Bump BEFORE the early return: a speak() that is still fetching or
    // decoding has no #source yet, and returning here made cancel() a silent
    // no-op for the whole 1–2 s window — the reply arrived a beat later,
    // unstoppable.
    this.#epoch++;
    const source = this.#source;
    if (!source) return;
    const now = this.#ctx.currentTime;
    // A hard stop() pops; ramping the gain down first is the whole reason this
    // is WebAudio and not <audio>.
    this.#gain.gain.cancelScheduledValues(now);
    this.#gain.gain.setValueAtTime(this.#gain.gain.value, now);
    this.#gain.gain.linearRampToValueAtTime(0, now + FADE_MS / 1000);
    source.stop(now + FADE_MS / 1000);
    const finish = this.#finish;
    this.#clear();
    finish?.();
  }

  #clear() {
    this.#source = null;
    this.#finish = null;
  }
}

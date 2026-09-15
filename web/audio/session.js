// The session state machine. Spec §5.2, §5.3, §5.5 and §4.5 live here.
//
// It knows nothing about AudioWorklet, getUserMedia or wasm: everything arrives
// through the constructor, including both clocks. That is not decoration — none
// of those APIs exist in node:test, and pushing the logic out of them is the
// only way this file can be tested at all (§10).

/** Spec §5.2. Also, by construction, the longest the car can run: the clock
 *  ticks only in LISTENING, so a cruise ends "30 s after you last said
 *  anything", not 30 s after it started. */
export const IDLE_TO_SLEEP_MS = 30000;

/** @typedef {'SLEEPING'|'LISTENING'|'CAPTURING'|'THINKING'|'SPEAKING'} State */
/** @typedef {import('./earcon.js').EarconName} EarconName */

/**
 * Spec §5.3's table, as a table. Five rows there, five rows here — the point of
 * writing it this way is that nobody has to reconstruct the table from
 * scattered imperative switches, which is where combination defects breed.
 *
 * @param {State} state
 * @param {boolean} bargeIn
 * @param {boolean} earconPlaying
 * @returns {{ kws: boolean, vad: boolean }}
 */
export function wantedSubscriptions(state, bargeIn, earconPlaying) {
  const rows = [
    { when: earconPlaying, kws: false, vad: false },
    { when: state === 'SLEEPING', kws: true, vad: false },
    { when: state === 'SPEAKING' && bargeIn, kws: true, vad: true },
    { when: state === 'SPEAKING' && !bargeIn, kws: true, vad: false },
    { when: true, kws: true, vad: true },
  ];
  const row = /** @type {{ kws: boolean, vad: boolean }} */ (rows.find((r) => r.when));
  return { kws: row.kws, vad: row.vad };
}

export class Session {
  #pipeline; #kws; #vad; #stt; #tts; #executor; #rawEarcon; #config;
  #now; #after; #onState;
  /** @type {any} */ #brain = null;
  /** @type {State} */ #state = 'SLEEPING';
  #lastVoiceAt = 0;
  #earconUntil = 0;

  /**
   * @param {{
   *   pipeline: { subscribe(name: string, fn: (frame: Float32Array) => void): void,
   *               unsubscribe(name: string): void },
   *   kws: { accept(frame: Float32Array): string[] },
   *   vad: { accept(frame: Float32Array): void, readonly detected: boolean,
   *          drain(): Float32Array[], clear(): void },
   *   stt: { transcribe(pcm: Int16Array, rate: number,
   *                     opts?: { signal?: AbortSignal }): Promise<string> },
   *   tts: { speak(text: string, opts?: { signal?: AbortSignal }): Promise<void>,
   *          cancel(): void },
   *   executor: { stop(): Promise<void> | void },
   *   earcon: (name: EarconName) => number,
   *   config: { lang: 'en' | 'zh', replyLang: 'en' | 'zh' | null, bargeIn: boolean },
   *   now?: () => number,
   *   after?: (ms: number, fn: () => void) => void,
   *   onState?: (state: State) => void,
   * }} deps
   */
  constructor(deps) {
    this.#pipeline = deps.pipeline;
    this.#kws = deps.kws;
    this.#vad = deps.vad;
    this.#stt = deps.stt;
    this.#tts = deps.tts;
    this.#executor = deps.executor;
    this.#rawEarcon = deps.earcon;
    this.#config = deps.config;
    this.#now = deps.now ?? (() => Date.now());
    this.#after = deps.after
      ?? ((/** @type {number} */ ms, /** @type {() => void} */ fn) =>
        void setTimeout(fn, ms));
    this.#onState = deps.onState ?? (() => {});
  }

  get state() { return this.#state; }

  /** brain.js is constructed with THIS session's earcon and tts wrappers, so it
   *  cannot be a constructor argument. Two-step wiring, on purpose. */
  attach(/** @type {any} */ brain) { this.#brain = brain; }

  /** The earcon brain.js must be given, so §5.6's gate covers its beeps too
   *  rather than only the ones the session plays itself. */
  get earcon() { return (/** @type {EarconName} */ name) => this.#playEarcon(name); }

  start() {
    this.#lastVoiceAt = this.#now();
    this.#reconcile();
  }

  /** Enter a session. Public because the UI's start button and §7.3's
   *  calibration both need to do it without a microphone. */
  wake() {
    this.#playEarcon('wake');
    this.#setState('LISTENING');
  }

  /** TEMPORARY, removed in task 12 once a real turn can end. Tests need a way
   *  back from CAPTURING without going through STT. */
  backToListeningForTest() { this.#setState('LISTENING'); }

  // --- frame handlers, registered and removed by #reconcile ------------------

  #onKwsFrame = (/** @type {Float32Array} */ frame) => {
    for (const label of this.#kws.accept(frame)) this.#onKeyword(label);
  };

  #onVadFrame = (/** @type {Float32Array} */ frame) => {
    this.#vad.accept(frame);
    this.#noteVoice();
    for (const seg of this.#vad.drain()) this.#onSegment(seg);
    this.#checkIdle();
  };

  #noteVoice() {
    if (!this.#vad.detected) return;
    this.#lastVoiceAt = this.#now();
    if (this.#state === 'LISTENING') this.#setState('CAPTURING');
  }

  #checkIdle() {
    // Only in LISTENING (§5.2). "Thirty seconds" measures "it was ready and you
    // said nothing", not "the car has been running a while" — an LLM thinking
    // for ten seconds is not the user being silent.
    if (this.#state !== 'LISTENING') return;
    if (this.#now() - this.#lastVoiceAt <= IDLE_TO_SLEEP_MS) return;
    this.#sleep();
  }

  #sleep() {
    // Never let a running car into SLEEPING (§5.2) — a cruise especially,
    // because nothing else would ever end it.
    this.#executor.stop();
    this.#vad.clear();
    this.#brain?.resetHistory();       // §6.4
    this.#playEarcon('sleep');
    this.#setState('SLEEPING');
  }

  #onSegment(/** @type {Float32Array} */ _samples) { /* Task 12 */ }
  #onKeyword(/** @type {string} */ _label) { /* Task 11 */ }

  // --- plumbing --------------------------------------------------------------

  /** @param {State} next */
  #setState(next) {
    if (next === this.#state) return;
    this.#state = next;
    // Entering LISTENING is what zeroes the clock. Without this, a turn that
    // took longer than 30 s would fall straight through to SLEEPING the moment
    // it handed control back — the opposite of what §5.2 measures.
    if (next === 'LISTENING') this.#lastVoiceAt = this.#now();
    this.#onState(next);
    this.#reconcile();
  }

  /** @param {EarconName} name @returns {number} */
  #playEarcon(name) {
    const ms = this.#rawEarcon(name);
    this.#earconUntil = this.#now() + ms;
    this.#reconcile();
    this.#after(ms, () => this.#reconcile());
    return ms;
  }

  #reconcile() {
    const want = wantedSubscriptions(
      this.#state, this.#config.bargeIn, this.#now() < this.#earconUntil,
    );
    this.#gate('kws', want.kws, this.#onKwsFrame);
    this.#gate('vad', want.vad, this.#onVadFrame);
  }

  /** @param {string} name @param {boolean} on @param {(f: Float32Array) => void} fn */
  #gate(name, on, fn) {
    if (on) this.#pipeline.subscribe(name, fn);
    else this.#pipeline.unsubscribe(name);
  }
}

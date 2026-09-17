// The session state machine. Spec §5.2, §5.3, §5.5 and §4.5 live here.
//
// It knows nothing about AudioWorklet, getUserMedia or wasm: everything arrives
// through the constructor, including both clocks. That is not decoration — none
// of those APIs exist in node:test, and pushing the logic out of them is the
// only way this file can be tested at all (§10).

import { classifyLabel, WAKE, STOP } from './keyword-lines.js';
import { RATE } from './pipeline.js';
import { toInt16 } from './pcm.js';
import { rms, aboveFloor } from './level.js';
import { t } from '../strings.js';

/** Spec §5.2. Also, by construction, the longest the car can run: the clock
 *  ticks only in LISTENING, so a cruise ends "30 s after you last said
 *  anything", not 30 s after it started. */
export const IDLE_TO_SLEEP_MS = 30000;

/**
 * A VAD segment quieter than this never becomes a turn, and a frame quieter
 * than this never counts as the user still being there.
 *
 * The VAD cutting a segment is not evidence that anybody spoke. Measured on
 * 2026-09-17, one phone, one room, echoCancellation on: real speech landed at
 * −20…−25 dBFS, and the bursts Chrome's residual echo suppressor lets through
 * in a silent room landed at −44…−96 — thirteen of them across two runs. −40
 * sits 4 dB above the loudest burst and 15 dB below the quietest speech.
 *
 * Deliberately biased towards refusing: a real command thrown away costs the
 * user a repeat, a burst let through costs a hallucinated transcript driving
 * the car. Duration cannot do this job — the same runs put 「回来」at 0.4 s and
 * bursts at 0.4 s, 6.4 s and 10.6 s.
 */
export const SPEECH_FLOOR_DB = -40;

/**
 * A transcript the model was this unsure of is treated as not heard.
 *
 * A SECOND axis, catching a different failure: SPEECH_FLOOR_DB refuses quiet
 * noise, this refuses loud nonsense. 「谢谢大家」at −21 dB, 「我以来」for
 * 「倒回来」, 「请我一下来」for 「停下来」, and the STT prompt echoed back
 * verbatim all arrived at −20…−25 dB — a perfectly good input level — and all
 * sat below −1.
 *
 * Across the seventeen readings taken on 2026-09-17 this threw away seven and
 * lost no correct transcript. It is not a sufficient check: 「Don't go out.」
 * for 「把灯关了」came back at −0.21, confidently wrong. A veto, never a
 * licence — above the floor means only that this axis has no objection.
 *
 * `no_speech_prob` would have been the natural instrument. It reported 0.00
 * for every one of those readings, including a −92 dB segment: no information
 * on this endpoint, so nothing is built on it.
 */
export const LOGPROB_FLOOR = -1;

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
  /** @type {AbortController | null} */ #ctrl = null;
  #gen = 0;

  /**
   * @param {{
   *   pipeline: { subscribe(name: string, fn: (frame: Float32Array) => void): void,
   *               unsubscribe(name: string): void },
   *   kws: { accept(frame: Float32Array): string[] },
   *   vad: { accept(frame: Float32Array): void, readonly detected: boolean,
   *          drain(): Float32Array[], clear(): void },
   *   stt: { transcribeDetailed(pcm: Int16Array, rate: number,
   *                     opts?: { signal?: AbortSignal }):
   *            Promise<{ text: string, logprob: number | null }> },
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

  // --- frame handlers, registered and removed by #reconcile ------------------

  #onKwsFrame = (/** @type {Float32Array} */ frame) => {
    for (const label of this.#kws.accept(frame)) this.#onKeyword(label);
  };

  #onVadFrame = (/** @type {Float32Array} */ frame) => {
    this.#vad.accept(frame);
    this.#noteVoice(frame);
    for (const seg of this.#vad.drain()) this.#onSegment(seg);
    this.#checkIdle();
  };

  /** @param {Float32Array} frame */
  #noteVoice(frame) {
    if (!this.#vad.detected) return;
    // §5.2's thirty seconds measures "it was ready and you said nothing", and
    // the VAD reporting `detected` is not the same as somebody having spoken.
    // One spurious burst a minute resets this clock forever, and the car then
    // never reaches SLEEPING — the timer simply never expires, with nothing in
    // any log to show for it.
    if (!aboveFloor(rms(frame), SPEECH_FLOOR_DB)) return;
    this.#lastVoiceAt = this.#now();
    // The user talking over the reply ends the turn (§8.1). Only reachable with
    // bargeIn on — §5.3 unsubscribes VAD during SPEAKING otherwise — so this
    // cannot fire on the bargeIn = false path.
    if (this.#state === 'SPEAKING') {
      this.#abortTurn();
      this.#tts.cancel();
    }
    if (this.#state === 'LISTENING' || this.#state === 'SPEAKING') {
      this.#setState('CAPTURING');
    }
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

  /** @param {Float32Array} samples */
  #onSegment(samples) {
    // Only an idle session takes new input. §5.2 has no arrow back from
    // THINKING or SPEAKING, and two turns racing would answer one instruction
    // twice — with two sets of car actions. During SPEAKING with bargeIn on,
    // #noteVoice has already ended the turn before the segment lands here, so
    // this is not the path that swallows an interruption.
    if (this.#state !== 'CAPTURING' && this.#state !== 'LISTENING') return;
    // Nothing quiet enough to be a burst gets to spend money, let alone reach
    // the executor. Silent on purpose — no earcon, because answering this
    // would be answering nobody.
    if (!aboveFloor(rms(samples), SPEECH_FLOOR_DB)) return;
    void this.#turn(samples);
  }

  /** @param {Float32Array} samples */
  async #turn(samples) {
    const gen = ++this.#gen;
    const ctrl = new AbortController();
    this.#ctrl = ctrl;
    this.#setState('THINKING');

    let heard;
    try {
      heard = await this.#stt.transcribeDetailed(
        toInt16(samples), RATE, { signal: ctrl.signal },
      );
    } catch {
      // Cancelling is not failing. Reporting a fault here would answer "the
      // user changed their mind" with a failure report — the same distinction
      // brain.js draws around chat().
      if (gen !== this.#gen) return;
      this.#playEarcon('error');
      await this.#speakFixed('apiFailed');
      return this.#endTurn(gen);
    }
    if (gen !== this.#gen) return;

    // §6.7 row 1: an empty or garbled transcript never reaches the LLM. Empty
    // is the easy half; the other half arrives as fluent Chinese that simply is
    // not what was said, and the model's own confidence is the only thing on
    // hand that tells the two apart — see LOGPROB_FLOOR. A null logprob means
    // the endpoint did not say, which is not the same as a low one.
    const text = heard.text.trim();
    const unsure = heard.logprob !== null && heard.logprob < LOGPROB_FLOOR;
    if (!text || unsure) {
      this.#playEarcon('huh');
      return this.#endTurn(gen);
    }

    // Brain owns the rest of the turn: the LLM, the validator, the executor,
    // the earcons and the reply. It speaks through this.speakingTts, which is
    // what puts the session into SPEAKING for exactly the playback.
    await this.#brain.handle(text);
    this.#endTurn(gen);
  }

  /**
   * §6.7: if the thing that failed IS the TTS, this line cannot be spoken. The
   * `error` earcon has already played; do not retry — that is asking the path
   * just proven dead to report that it is dead.
   * @param {import('../strings.js').StringKey} key
   */
  async #speakFixed(key) {
    await this.speakingTts.speak(t(this.#config.lang, key)).catch(() => {});
  }

  /** @param {number} gen */
  #endTurn(gen) {
    if (gen !== this.#gen) return;
    this.#setState('LISTENING');
  }

  /**
   * The tts brain.js must be constructed with. SPEAKING has to bracket exactly
   * the playback — not the whole turn, or §5.3's bargeIn = false row would
   * unsubscribe VAD for the LLM's thinking time as well.
   */
  get speakingTts() {
    return {
      /** @param {string} text @param {{ signal?: AbortSignal }} [opts] */
      speak: async (text, opts) => {
        // A cancelled turn can still have a continuation running inside it —
        // brain.handle() resuming after cancel() and reaching its reply. It
        // must not take the mouth, and it must not take the state machine
        // with it. #ctrl is null exactly when the last turn was abandoned, so
        // it, not #gen, is what says "no turn owns this". Reading #gen here
        // would capture the generation the abort just moved TO, and the zombie
        // would pass every check below.
        if (this.#ctrl === null) return;
        const gen = this.#gen;
        this.#setState('SPEAKING');
        try {
          await this.#tts.speak(text, opts);
        } finally {
          // The generation check is the whole fix for the spike's second bug:
          // an unconditional setState('LISTENING') here undoes the SLEEPING
          // that `all stop` just set, one tick later and invisibly.
          if (gen === this.#gen) this.#setState('LISTENING');
        }
      },
      cancel: () => this.#tts.cancel(),
    };
  }

  /** @param {string} label */
  #onKeyword(label) {
    const kind = classifyLabel(label);
    // A label no shipped keyword file produces means somebody renamed one.
    // Guessing at it is how a stop word quietly becomes a no-op.
    if (kind === STOP) return this.onEmergencyStop();
    if (kind === WAKE) return this.#onWake();
  }

  /**
   * Spec §5.5. The wake word means "I am about to say a command", so the half
   * sentence behind it is the message and the VAD buffer is NOT cleared. During
   * playback it is the poor man's barge-in: it shuts the robot up and does
   * nothing else. It must not share a branch with the stop word.
   */
  #onWake() {
    const interrupting = this.#state === 'SPEAKING' || this.#state === 'THINKING';
    this.#abortTurn();
    this.#tts.cancel();
    // No earcon when interrupting: the user is already talking, and §5.6's gate
    // would drop exactly the frames carrying what they are saying.
    if (!interrupting) this.#playEarcon('wake');
    this.#setState('LISTENING');
  }

  /**
   * Spec §4.1 layer 1 and layer 2 both arrive here. The order is not
   * negotiable: stop the car FIRST, without going through any intermediate
   * layer, then let the state machine tidy itself. If the machine is wedged on
   * an await the car has already stopped; if the tidying throws, the car has
   * still stopped. "The button works" and "the state is consistent" are two
   * different things, and the first one wins.
   */
  onEmergencyStop() {
    this.#executor.stop();
    this.#abortTurn();
    this.#tts.cancel();
    // The opposite of the wake word: "stop now, never mind the rest" — whatever
    // is in hand is not wanted (§5.5).
    this.#vad.clear();
    this.#brain?.resetHistory();
    this.#playEarcon('sleep');
    this.#setState('SLEEPING');
  }

  /** §4.5's third use: not merely ignore a stale result — cancel the request
   *  still in flight, and make sure nothing it returns can set a state. */
  #abortTurn() {
    this.#gen++;
    this.#ctrl?.abort();
    this.#ctrl = null;
    this.#brain?.cancel();
  }

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

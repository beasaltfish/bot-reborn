// One getUserMedia, one worklet, many subscribers (spec §5.1).
//
// The microphone is held for the entire life of the page — never stop(), never
// enabled = false. Unsubscribing is not the same as closing the mic: the gate
// is downstream of the fan-out (§5.3). Letting the track go would cost a
// permission prompt and the "a page holding the mic is harder to freeze"
// insurance along with it, and enabled = false would make KWS deaf too, so not
// even the wake word could bring it back.

export const RATE = 16000;
export const FRAME_MS = 100;

/**
 * autoGainControl off: it would ride the level of a quiet room up and make the
 * noise floor §5.8 cares about meaningless. Not a parameter — it is what makes
 * the numbers mean anything.
 *
 * echoCancellation IS a parameter, because waiting item ⑥ measures it: the
 * audio bench's acoustics panel runs the barge-in self-test with it both on
 * and off. The default is the product value.
 *
 * noiseSuppression DEFAULTS ON as of 2026-09-17, reversing the rule that used
 * to forbid it outright. The old reason was never disproved — the suppressor
 * eats the consonant onsets the wake word is made of, `HH EY1 S T IY1 V AH0 N`
 * is nearly all onset, and turning it on measurably raised the miss rate on
 * the phone. The trade was taken deliberately:
 *
 * - The cost lands on a keyword spotter that is on its way out. Matching a
 *   phoneme string is the weak way to do this; a model trained on the phrase
 *   itself does not depend on those onsets surviving, and does not care what
 *   the suppressor did to them.
 * - The benefit lands on something with no replacement queued. With AEC on and
 *   the room silent, Chrome's residual suppressor lets low-level bursts
 *   through and silero reads them as speech — measured at −44 dB down to −96
 *   against −20…−25 for real speech, one to two a minute, forever. In the
 *   product that is not a bench cost: §5.2's idle timer never expires, so the
 *   car never sleeps, and a hallucinated transcript reaches the executor.
 * - Switching it per state — off in SLEEPING where only KWS runs, on elsewhere
 *   — would have cost nothing and was the first choice. Chrome refuses:
 *   applyConstraints on a live track ignores the ideal form silently and
 *   rejects the exact form with "Cannot satisfy constraints". It is not a
 *   setting that can be changed after getUserMedia.
 *
 * session.js's level floor stays regardless. The suppressor removes the cause,
 * the floor refuses the symptom, and neither is asked to be the only one.
 *
 * @param {{ echoCancellation?: boolean, noiseSuppression?: boolean }} [opts]
 * @returns {MediaStreamConstraints}
 */
export function micConstraints(opts = {}) {
  return {
    audio: {
      echoCancellation: opts.echoCancellation ?? true,
      autoGainControl: false,
      noiseSuppression: opts.noiseSuppression ?? true,
    },
  };
}

/**
 * How many 100 ms frames never arrived in a stretch of wall clock.
 *
 * This is the one number option B hangs on. Switching noiseSuppression on a
 * live track may cost nothing, or may make Chrome tear the audio processing
 * chain down and rebuild it — and the state machine wants to switch at exactly
 * the SLEEPING → LISTENING edge, which is the instant the wake word fires. A
 * hole there lands on 「往」 in "hey steven 往前走", with no VAD buffer behind
 * it to soften the loss: §5.3 leaves the VAD unsubscribed all through
 * SLEEPING, so LISTENING has to catch the command from its very first frame.
 *
 * Clamped at zero. The worklet can deliver a frame slightly early, and letting
 * that read as a negative hole would let it cancel out a real stall later.
 *
 * @param {number} fed frames actually delivered in the window
 * @param {number} elapsedMs wall clock the window covered
 * @returns {number}
 */
export function gapFrames(fed, elapsedMs) {
  return Math.max(0, Math.round(elapsedMs / FRAME_MS) - fed);
}

/**
 * Ask a live track to change its processing, and report what it actually did.
 *
 * applyConstraints() may resolve having changed nothing — the spec lets an
 * implementation ignore a constraint it does not support, and it does so
 * silently. So the answer never comes from what was asked; it comes from
 * getSettings() afterwards. A rejection is data too, not an exception: "this
 * browser will not switch" is a perfectly good finding for B.
 *
 * @param {MediaStreamTrack} track
 * @param {{ noiseSuppression?: boolean, echoCancellation?: boolean }} patch
 * @returns {Promise<{ error: string | null, settings: MediaTrackSettings,
 *   took: 'ideal' | 'exact' | null }>} `took` is which form of the constraint
 *   actually moved the track, or null if neither did.
 */
export async function reprocessTrack(track, patch) {
  /** @param {any} s */
  const matches = (s) => Object.entries(patch).every(([k, v]) => s[k] === v);
  /** @param {any} c */
  const attempt = async (c) => {
    try {
      await track.applyConstraints(c);
      return null;
    } catch (err) {
      return /** @type {Error} */ (err).message;
    }
  };

  let error = await attempt(patch);
  let settings = track.getSettings();
  if (error === null && matches(settings)) return { error, settings, took: 'ideal' };

  // The plain form is an `ideal` constraint, and the spec lets an
  // implementation ignore one silently — which is what Chrome does here:
  // applyConstraints resolves, no error, getSettings() unmoved. `exact` is the
  // form that is not allowed to do that: it must either take effect or reject
  // with OverconstrainedError. Trying it is what separates "this browser will
  // not" from "this browser cannot", and those are different findings.
  error = await attempt(Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [k, { exact: v }]),
  ));
  settings = track.getSettings();
  return { error, settings, took: matches(settings) ? 'exact' : null };
}

export class AudioPipeline {
  /** @type {Map<string, (frame: Float32Array) => void>} */ #subs = new Map();
  #fed = 0;
  #startedAt = 0;
  /** @type {AudioContext | null} */ #ctx = null;
  /** @type {AudioWorkletNode | null} */ #node = null;
  /** @type {MediaStream | null} */ #stream = null;

  /** @param {{ onRate?: (hz: number) => void, echoCancellation?: boolean,
   *            noiseSuppression?: boolean }} [opts] */
  static async start(opts = {}) {
    const p = new AudioPipeline();
    p.#stream = await navigator.mediaDevices.getUserMedia(micConstraints(opts));
    const ctx = makeContext();
    p.#ctx = ctx;
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    const node = new AudioWorkletNode(ctx, 'capture');
    p.#node = node;

    const onRate = opts.onRate ?? (() => {});
    // The worklet's first message is a hello carrying the rate it actually got.
    // Handling it by replacing the handler puts "exactly once, before any
    // frame" into the control flow rather than into a comment.
    node.port.onmessage = (ev) => {
      onRate(ev.data.sampleRate);
      node.port.onmessage = (e) => p.#deliver(e.data.frame);
    };
    ctx.createMediaStreamSource(p.#stream).connect(node);
    p.#startedAt = Date.now();
    return p;
  }

  /** @param {Float32Array} frame */
  #deliver(frame) {
    this.#fed++;
    for (const fn of this.#subs.values()) fn(frame);
  }

  /** @param {string} name @param {(frame: Float32Array) => void} fn */
  subscribe(name, fn) { this.#subs.set(name, fn); }
  /** @param {string} name */
  unsubscribe(name) { this.#subs.delete(name); }
  get subscribers() { return [...this.#subs.keys()]; }
  /** Frames actually handed to subscribers. §5.8 compares this to the wall. */
  get fedFrames() { return this.#fed; }
  get startedAt() { return this.#startedAt; }
  /** Always set by the time start() resolves — the cast says so rather than
   *  making every caller re-check something that cannot be null. */
  get audioContext() { return /** @type {AudioContext} */ (this.#ctx); }

  /**
   * Change the microphone's processing without reopening it, and measure what
   * the change cost in frames. Nothing in the product calls this yet: it is
   * the instrument for option B, and B does not get wired to session.js until
   * this reports a gap somebody has actually seen.
   *
   * @param {{ noiseSuppression?: boolean, echoCancellation?: boolean }} patch
   * @param {number} [settleMs] how long to keep counting after the switch
   */
  async reprocess(patch, settleMs = 1000) {
    const track = this.#stream?.getAudioTracks()[0];
    // Same shape on both paths: a caller reading `took` must not have to know
    // which branch answered it.
    if (!track) {
      return {
        error: 'the microphone is not open',
        settings: /** @type {MediaTrackSettings} */ ({}),
        took: /** @type {'ideal' | 'exact' | null} */ (null),
        gap: 0,
        ms: 0,
      };
    }
    const fedBefore = this.#fed;
    const at = Date.now();
    const done = await reprocessTrack(track, patch);
    // Counting continues past the resolve on purpose: a rebuild can finish the
    // promise and still be missing frames afterwards.
    await new Promise((r) => setTimeout(r, settleMs));
    const ms = Date.now() - at;
    return { ...done, gap: gapFrames(this.#fed - fedBefore, ms), ms };
  }

  stop() {
    this.#node?.disconnect();
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#ctx?.close();
  }
}

/** 16 kHz if the browser will give it, whatever it offers otherwise — the
 *  worklet resamples either way, so there is no branch downstream of this. */
function makeContext() {
  try { return new AudioContext({ sampleRate: RATE }); }
  catch { return new AudioContext(); }
}

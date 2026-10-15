// Five sounds, synthesised on the spot. Spec §5.6 fixes the vocabulary at
// exactly five and it will not grow: three kinds of failure share `error`,
// because "beep, then it explains itself" and "beep, then nothing" are already
// distinguishable by ear, and six tones is a thing to learn.
//
// Pure tones only — no formants — so VAD does not read them as speech and KWS
// does not read them as a keyword.

export const EARCONS = /** @type {const} */ (['wake', 'done', 'sleep', 'huh', 'error']);

/** @typedef {typeof EARCONS[number]} EarconName */

/**
 * Each entry is one tone: start frequency, end frequency, milliseconds.
 * @type {Record<EarconName, { f: number, to: number, ms: number }[]>}
 */
export const SHAPES = {
  // `wake` is the short one on purpose, and 80 ms is §5.6's own figure for how
  // long the pipeline is gated. It is the only earcon that lands while the user
  // may already be mid-sentence — "hey steven 往前走" said in one breath — and
  // every gated millisecond is a millisecond of 「往」 that never reaches the
  // VAD's ring. That is the same head §5.5 refused to throw away by clearing
  // the buffer; it must not be thrown away through the gate instead.
  wake: [{ f: 660, to: 660, ms: 40 }, { f: 880, to: 880, ms: 40 }],   // ding — dong
  done: [{ f: 880, to: 880, ms: 80 }],                                // blip
  // The next three play when nobody is expected to be speaking, so they can
  // afford to be legible.
  sleep: [{ f: 660, to: 330, ms: 200 }],                              // falling
  huh: [{ f: 440, to: 660, ms: 120 }],                                // huh?
  error: [{ f: 220, to: 220, ms: 110 }, { f: 185, to: 185, ms: 120 }], // low two-tone
};

/** @param {EarconName} name @returns {number} total milliseconds */
export function durationOf(name) {
  return SHAPES[name].reduce((ms, tone) => ms + tone.ms, 0);
}

/**
 * @param {AudioContext} ctx
 * @returns {(name: EarconName) => number} plays, and returns how long it will
 *   last, so the caller can gate the pipeline for exactly that long (§5.6).
 */
export function createEarcon(ctx) {
  return (name) => {
    let at = ctx.currentTime;
    for (const tone of SHAPES[name]) {
      const secs = tone.ms / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(tone.f, at);
      osc.frequency.linearRampToValueAtTime(tone.to, at + secs);
      // An 8 ms ramp at each end. A square-edged gate clicks, and a click is
      // broadband — exactly the thing this file promises not to emit.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.008);
      gain.gain.setValueAtTime(0.25, at + secs - 0.008);
      gain.gain.linearRampToValueAtTime(0, at + secs);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + secs);
      at += secs;
    }
    return durationOf(name);
  };
}

// The keep-alive sound, and the detector that says when it stopped working.
//
// Without adb attached, android takes the microphone back about 60 seconds
// after the screen goes off — the audio clock and the fed counter stop
// TOGETHER, which says the capture path was closed, not that the main thread
// was frozen. A tab that is playing audio keeps its media session, keeps its
// foreground identity, and keeps its microphone.
//
// This is borrowed behaviour, not a contract. A different android version can
// take it away, silently. Hence the detector below: it is not decoration, it is
// the only way this failure ever becomes visible to anyone.

import { FRAME_MS } from './pipeline.js';

export const KEEPALIVE = {
  carrier: 220,   // Hz. The first attempt used 60 Hz; the phone speaker could
                  // not produce it and emitted distortion instead.
  secs: 4,        // one full swell
  lfo: 0.25,      // 4 s period
  depth: 0.7,     // trough at 30% — a trough that reaches zero gets the tab
                  // judged silent once per cycle
  dbfs: -40,      // well above Chrome's ≈ −60 dBFS silence threshold, well
                  // below audible across a room
  rate: 8000,
};

/** §5.8: fed >= wall − 5. Below that it is scheduling jitter, not a failure. */
export const BEHIND_FRAMES = 5;

/** @param {number} elapsedMs @param {number} [frameMs] */
export const expectedFrames = (elapsedMs, frameMs = FRAME_MS) =>
  Math.round(elapsedMs / frameMs);

/** @param {number} fed @param {number} elapsedMs @param {number} [frameMs] */
export const framesBehind = (fed, elapsedMs, frameMs = FRAME_MS) =>
  Math.max(0, expectedFrames(elapsedMs, frameMs) - fed);

/** @param {number} fed @param {number} elapsedMs @param {number} [frameMs] */
export const isBehind = (fed, elapsedMs, frameMs = FRAME_MS) =>
  framesBehind(fed, elapsedMs, frameMs) > BEHIND_FRAMES;

/** A four-second loop of the breathing tone, as a blob URL. */
export function keepAliveWavUrl() {
  const { rate, secs, carrier, lfo, depth, dbfs } = KEEPALIVE;
  const amp = 10 ** (dbfs / 20);
  const n = Math.round(rate * secs);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const ascii = (/** @type {number} */ off, /** @type {string} */ text) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(off + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ascii(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = 1 - depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * lfo * t));
    dv.setInt16(44 + i * 2,
      Math.sin(2 * Math.PI * carrier * t) * amp * env * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * Spec §5.8's condition, on its own so it can be tested and so the bench can
 * override it. `always` is the control arm of waiting item ⑫: ⑤ established
 * that playing the whole time keeps the microphone, and ⑫ asks whether the
 * gated version survives Chrome's autoplay policy. Comparing them needs both.
 *
 * @param {boolean} hidden `document.hidden`
 * @param {boolean} [always]
 */
export function shouldPlay(hidden, always = false) {
  return always || hidden;
}

/**
 * Spec §5.8: play when the page is not in the foreground, mute when it comes
 * back. One condition, and no USER-facing switch — it is a mechanism, not a
 * preference. If it is loud enough to want turned off, the shape is wrong.
 *
 * `always` is not that switch: it exists for the audio bench, which measures
 * this mechanism (⑫ ⑬ ⑭ ⑮) and needs the ungated arm to compare against. The
 * product never passes it.
 *
 * @param {{ onLog?: (msg: string) => void, always?: boolean }} [opts]
 */
export function createKeepAlive(opts = {}) {
  const log = opts.onLog ?? (() => {});
  const always = opts.always ?? false;
  const el = new Audio();
  el.loop = true;
  el.src = keepAliveWavUrl();
  el.volume = 1;

  const sync = () => {
    const done = shouldPlay(document.hidden, always)
      ? el.play()
      : Promise.resolve(el.pause());
    Promise.resolve(done).catch((err) => log('keep-alive: ' + err.message));
  };

  return {
    /**
     * Must be called synchronously from a user gesture, BEFORE any await:
     * autoplay needs the gesture and a single await spends it. It plays once to
     * bank the permission, then obeys the visibility rule from then on.
     */
    async armFromGesture() {
      document.addEventListener('visibilitychange', sync);
      await el.play();
      sync();
    },
    stop() {
      document.removeEventListener('visibilitychange', sync);
      el.pause();
      URL.revokeObjectURL(el.src);
    },
  };
}

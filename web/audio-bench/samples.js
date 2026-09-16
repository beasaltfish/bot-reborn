// Recording a calibration sample, and replaying it through the live path.
//
// ⑯ compares bufferSeconds at 30 / 15 / 10 / 5. Saying the twenty sentences
// again for each value would compare different inputs against different
// parameters, which answers nothing — so a sample is recorded once and every
// sweep replays the same audio.
//
// Storage is fixture-store.js, the module setup.html already uses, under a
// `calib/` prefix. Its keys are relative paths, so the two sets never collide.

import { saveFixture, matchFixture, listFixtures, deleteFixture } from '../fixture-store.js';
import { encodeWav } from '../audio/wav.js';
import { toInt16, joinFrames } from '../audio/pcm.js';
import { RATE } from '../audio/pipeline.js';

export const PREFIX = 'calib/';

/**
 * Cut a decoded clip into the same 100 ms frames the worklet delivers, so a
 * replay and a live capture enter the VAD through one code path.
 *
 * The tail is zero-padded rather than dropped. Dropping it would cost the end
 * of every clip, and ⑯'s "talk for longer than bufferSeconds" step is about
 * exactly the end; padding under one frame cannot trip the VAD's endpoint,
 * which needs 800 ms of silence.
 *
 * @param {Float32Array} samples
 * @param {number} frameSize
 * @returns {Float32Array[]}
 */
export function sliceFrames(samples, frameSize) {
  /** @type {Float32Array[]} */
  const out = [];
  for (let off = 0; off < samples.length; off += frameSize) {
    // Always a fresh buffer, never a subarray view: the live path hands the
    // VAD a buffer the worklet transferred and nobody else holds, and replay
    // must not be the one place where two readers share memory.
    const frame = new Float32Array(frameSize);
    frame.set(samples.subarray(off, Math.min(off + frameSize, samples.length)));
    out.push(frame);
  }
  return out;
}

/**
 * @param {{ pipeline: { subscribe(n: string, fn: (f: Float32Array) => void): void,
 *                       unsubscribe(n: string): void },
 *           log: (msg: string) => void }} opts
 */
export function createRecorder(opts) {
  const SUB = 'bench-recorder';
  /** @type {Float32Array[]} */ let frames = [];
  /** @type {string | null} */ let path = null;

  return {
    get recording() { return path !== null; },

    /** @param {string} p relative path, e.g. 'calib/kws-03.wav' */
    start(p) {
      if (path) return;
      frames = [];
      path = p;
      opts.pipeline.subscribe(SUB, (f) => frames.push(f));
      opts.log(`● recording ${p}`);
    },

    async stop() {
      if (!path) return;
      opts.pipeline.unsubscribe(SUB);
      const samples = joinFrames(frames);
      const seconds = samples.length / RATE;
      await saveFixture(path, encodeWav(toInt16(samples), RATE));
      opts.log(`■ saved ${path} (${seconds.toFixed(1)} s)`);
      path = null;
      frames = [];
    },
  };
}

/**
 * @param {string} path
 * @returns {Promise<Float32Array>} mono samples, guaranteed 16 kHz
 */
export async function loadSamples(path) {
  const res = await matchFixture(path);
  if (!res) throw new Error(`${path} is not recorded`);
  // An OfflineAudioContext at RATE, NOT the page's AudioContext.
  // decodeAudioData resamples to whichever context it is called on, the
  // browser is allowed to refuse 16 kHz for the live one (pipeline.js
  // makeContext falls back), and createVoiceDetector has sampleRate: 16000
  // written into it. Decoding at the wrong rate transposes the clip and every
  // duration the sweep reports — silently, which is the failure mode §5.4
  // keeps warning about.
  const off = new OfflineAudioContext(1, 1, RATE);
  const buf = await off.decodeAudioData(await res.arrayBuffer());
  return buf.getChannelData(0);
}

export { listFixtures, deleteFixture };

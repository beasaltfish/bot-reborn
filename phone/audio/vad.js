// The voice detector, plus the one mechanical thing it needs: silero wants
// EXACTLY 512-sample windows and the pipeline delivers 1600, so the remainder
// has to be carried between frames.
//
// Spec §5.4: the pre-roll is NOT maintained out here. vad.front() hands back a
// segment whose start is the real start of speech, computed in the same sample
// coordinates the detector used to decide. A hand-rolled 500 ms ring would have
// to guess how far back to reach, and that distance depends on how long the
// detector took to make up its mind — internal state, invisible from here, and
// it moves with minSpeechDuration.

export const VAD_WINDOW = 512;
const RATE = 16000;

/**
 * @param {{ Module: any, createVad: Function }} sherpa
 * @param {{ threshold?: number, minSilence?: number, minSpeech?: number,
 *           bufferSeconds?: number }} [opts]
 */
export function createVoiceDetector(sherpa, opts = {}) {
  const vad = sherpa.createVad(sherpa.Module, {
    sileroVad: {
      model: './silero_vad.onnx',
      threshold: opts.threshold ?? 0.5,
      // Spec §5.2: the endpoint is 800 ms of silence.
      minSilenceDuration: opts.minSilence ?? 0.8,
      minSpeechDuration: opts.minSpeech ?? 0.25,
      maxSpeechDuration: 20,
      windowSize: VAD_WINDOW,
    },
    tenVad: {
      model: '', threshold: 0.5, minSilenceDuration: 0.5,
      minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 256,
    },
    sampleRate: RATE, numThreads: 1, provider: 'cpu', debug: 0,
    // Waiting item ⑯: 30 is what the spike used and nobody has tried lowering
    // it. 30 s ≈ 1.9 MB. Do not tune it from here — ⑯ is a phone measurement.
    bufferSizeInSeconds: opts.bufferSeconds ?? 30,
  });

  let pending = new Float32Array(0);

  return {
    /** @param {Float32Array} frame */
    accept(frame) {
      const merged = new Float32Array(pending.length + frame.length);
      merged.set(pending);
      merged.set(frame, pending.length);
      let off = 0;
      for (; off + VAD_WINDOW <= merged.length; off += VAD_WINDOW) {
        vad.acceptWaveform(merged.subarray(off, off + VAD_WINDOW));
      }
      pending = merged.slice(off);
    },

    get detected() { return Boolean(vad.isDetected()); },

    /** @returns {Float32Array[]} whole segments, heads included */
    drain() {
      /** @type {Float32Array[]} */
      const out = [];
      while (!vad.isEmpty()) {
        out.push(vad.front().samples);
        vad.pop();
      }
      return out;
    },

    /** Throw away everything in hand. Used by the stop word, never by the wake
     *  word — §5.5: the half sentence after "hey steven" is the message. */
    clear() {
      pending = new Float32Array(0);
      vad.clear();
      vad.reset();
    },
  };
}

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

export class AudioPipeline {
  /** @type {Map<string, (frame: Float32Array) => void>} */ #subs = new Map();
  #fed = 0;
  #startedAt = 0;
  /** @type {AudioContext | null} */ #ctx = null;
  /** @type {AudioWorkletNode | null} */ #node = null;
  /** @type {MediaStream | null} */ #stream = null;

  /** @param {{ onRate?: (hz: number) => void }} [opts] */
  static async start(opts = {}) {
    const p = new AudioPipeline();
    // autoGainControl off: it would ride the level of a quiet room up and make
    // the noise floor §5.8 cares about meaningless. noiseSuppression off: it
    // eats the same consonant onsets the wake word is made of.
    p.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, autoGainControl: false, noiseSuppression: false },
    });
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
  get audioContext() { return this.#ctx; }

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

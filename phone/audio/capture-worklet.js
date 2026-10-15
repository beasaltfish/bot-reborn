// Mic → fixed 100 ms frames at 16 kHz.
//
// The resampler runs unconditionally. Chrome usually honours
// `new AudioContext({ sampleRate: 16000 })`, but a browser is free to hand back
// its native rate instead, and a frame that is silently 1/3 as long would skew
// both engines without failing anywhere visible. With `step = sampleRate /
// 16000` the same code is the identity when we got what we asked for, so there
// is no second path left untested.

const TARGET = 16000;
const FRAME = TARGET / 10;   // 1600 samples = 100 ms

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET;
    this.buf = new Float32Array(FRAME);
    this.n = 0;
    this.pos = 0;     // fractional read head, relative to the current block
    this.prev = 0;    // last sample of the previous block, for interpolation
    this.port.postMessage({ hello: true, sampleRate, frame: FRAME });
  }

  /** @param {Float32Array[][]} inputs */
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;   // mic not delivering yet; keep the node alive

    let p = this.pos;
    while (p < ch.length) {
      const i = Math.floor(p);
      const frac = p - i;
      const a = i < 0 ? this.prev : ch[i];
      const b = ch[i + 1] ?? a;
      this.buf[this.n++] = a + (b - a) * frac;
      if (this.n === FRAME) {
        const frame = this.buf.slice();
        // tEnd is on the same clock as AudioContext.currentTime. If the main
        // thread is frozen the frames do not vanish — they queue on the port
        // and arrive later in a burst — and a plain counter cannot tell that
        // apart from healthy running. §5.8's detection needs the difference.
        this.port.postMessage({ frame, tEnd: currentTime }, [frame.buffer]);
        this.n = 0;
      }
      p += this.step;
    }
    this.prev = ch[ch.length - 1];
    this.pos = p - ch.length;
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);

// audioWorklet.addModule() loads this as an ES module, so saying so is not a
// trick to satisfy tsc — it is what keeps the class name out of the global
// scope it would otherwise share with the spike's worklets.
export {};

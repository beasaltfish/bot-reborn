// Throwaway spike code. Not the real AudioPipeline (spec §5.1) — it only does
// the part ⑤ needs to measure: cut the mic into fixed 100 ms frames and stamp
// each one with the audio clock.
//
// The stamp is the whole point. If the main thread gets frozen the frames do
// not vanish, they queue on the port and arrive in a burst later; a plain
// "frames received" counter cannot tell that apart from healthy running.
// `tEnd` is on the same clock as AudioContext.currentTime, so the main thread
// can subtract and see how far behind it is.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 100 ms at whatever rate we actually got. Asking for a 16 kHz context
    // usually works, but a browser is free to hand back its native rate, and
    // a frame that is silently 1/3 as long would skew every number below.
    this.size = Math.round(sampleRate / 10);
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.port.postMessage({ hello: true, sampleRate, size: this.size });
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;  // mic not yet delivering; keep the node alive

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) {
        const frame = this.buf.slice();
        this.port.postMessage({ frame, tEnd: currentTime }, [frame.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);

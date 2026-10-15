// The body's speaker: PCM from the brain, played in the order it came, and
// dropped all at once on `hush` (server/body split spec §2).
//
// Each binary frame becomes one AudioBuffer scheduled where the last one ends.
// The brain paces what it sends to real time (server/body/mouth.js), so this
// queue stays about one network jitter long; when it runs dry the next chunk
// starts now rather than at a moment already gone.
//
// Played through the same AudioContext the microphone runs in, as the TTS
// always was: that is the path the echo canceller was measured on (item ⑥).

import { RATE } from '../../core/protocol.js';

export class PcmPlayer {
  #ctx;
  #next = 0;
  /** @type {Set<AudioBufferSourceNode>} */ #playing = new Set();

  /** @param {BaseAudioContext} ctx */
  constructor(ctx) { this.#ctx = ctx; }

  /** @param {ArrayBuffer} bytes 16-bit little-endian mono at RATE */
  play(bytes) {
    const n = bytes.byteLength >> 1;
    if (!n) return;
    const view = new DataView(bytes);
    const buffer = this.#ctx.createBuffer(1, n, RATE);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    const src = this.#ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.#ctx.destination);
    const at = Math.max(this.#ctx.currentTime, this.#next);
    src.start(at);
    this.#next = at + n / RATE;
    this.#playing.add(src);
    src.onended = () => { this.#playing.delete(src); };
  }

  /** Everything playing and everything queued stops now. */
  hush() {
    for (const src of this.#playing) {
      try { src.stop(); } catch { /* already ended */ }
    }
    this.#playing.clear();
    this.#next = 0;
  }
}

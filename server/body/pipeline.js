// The microphone, as the session sees it, when the microphone is on a body.
//
// session.js was written against AudioPipeline's subscribe/unsubscribe and
// 100 ms Float32 frames, and the thresholds it carries were measured on those
// frames. A body sends whatever chunk size suits it, so this re-cuts the
// stream to the same 100 ms rather than teaching the session a second shape.

import { FRAME_MS } from '../../web/audio/pipeline.js';
import { RATE } from '../../web/protocol.js';
import { bytesToFloat32 } from '../audio/pcm.js';

const FRAME = (RATE * FRAME_MS) / 1000;

export class RemotePipeline {
  /** @type {Map<string, (frame: Float32Array) => void>} */ #subs = new Map();
  #pending = new Float32Array(0);

  /** @param {string} name @param {(frame: Float32Array) => void} fn */
  subscribe(name, fn) { this.#subs.set(name, fn); }

  /** @param {string} name */
  unsubscribe(name) { this.#subs.delete(name); }

  get subscribers() { return [...this.#subs.keys()]; }

  /** @param {Uint8Array} bytes one binary frame from the body */
  feed(bytes) {
    const incoming = bytesToFloat32(bytes);
    const merged = new Float32Array(this.#pending.length + incoming.length);
    merged.set(this.#pending);
    merged.set(incoming, this.#pending.length);
    let off = 0;
    for (; off + FRAME <= merged.length; off += FRAME) {
      const frame = merged.slice(off, off + FRAME);
      // A copy of the list: a subscriber may unsubscribe another (the session
      // reconciles on every state change), and a Map mutated mid-iteration
      // would decide that by insertion order.
      for (const fn of [...this.#subs.values()]) fn(frame);
    }
    this.#pending = merged.slice(off);
  }

  clear() { this.#pending = new Float32Array(0); }
}

// The body's speaker, from the brain's side.
//
// One channel, first come first served: an ESP32 cannot be asked to mix, so
// a beep that arrives while the robot is talking waits its turn. Audio goes
// out LEAD_MS ahead of real time — enough to ride over network jitter, little
// enough that a body with no PSRAM can hold it, and little enough that `hush`
// has almost nothing already in flight to chase.

import { int16ToBytes } from '../audio/pcm.js';
import { RATE } from '../../core/protocol.js';

const CHUNK = RATE / 10;               // 100 ms
const CHUNK_MS = 100;
export const LEAD_MS = 300;
const SAMPLES_PER_MS = RATE / 1000;

/** @param {number} ms @param {() => void} fn */
const realAfter = (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); };

export class Mouth {
  #sendAudio; #send; #now; #after; #slackMs;
  /** @type {Int16Array[]} */ #queue = [];
  /** When the audio already sent will have finished playing, on our clock. */
  #sentUntil = 0;
  #pumpQueued = false;
  /** @type {Set<() => void>} */ #waiting = new Set();

  /**
   * @param {{ sendAudio: (bytes: Uint8Array) => void, send: (msg: object) => void,
   *           now?: () => number, after?: (ms: number, fn: () => void) => () => void,
   *           slackMs?: number }} opts
   *   `slackMs` is added to what play() reports and to `done`. The body
   *   hears its own sound a network round trip after we think it played, and
   *   both the ear gate and the end of SPEAKING have to wait that out.
   */
  constructor(opts) {
    this.#sendAudio = opts.sendAudio;
    this.#send = opts.send;
    this.#now = opts.now ?? (() => performance.now());
    this.#after = opts.after ?? realAfter;
    this.#slackMs = opts.slackMs ?? 0;
  }

  /**
   * @param {Int16Array} pcm 16 kHz mono
   * @returns {{ ms: number, started: Promise<void>, done: Promise<void> }}
   *   `ms` from now until this clip has played out, plus the slack — the
   *   number earcon() and sfx() must return to the session.
   */
  play(pcm) {
    const now = this.#now();
    const queuedMs = this.#queue.reduce((n, c) => n + c.length, 0) / SAMPLES_PER_MS;
    const startsIn = Math.max(0, this.#sentUntil - now) + queuedMs;
    const clipMs = pcm.length / SAMPLES_PER_MS;
    for (let i = 0; i < pcm.length; i += CHUNK) this.#queue.push(pcm.subarray(i, i + CHUNK));
    this.#pump();
    return {
      ms: Math.ceil(startsIn + clipMs + this.#slackMs),
      started: this.#wait(startsIn),
      // The slack too: with bargeIn off, SPEAKING is what keeps the VAD shut,
      // and ending it on our clock would open the ears while the body is
      // still playing the last words.
      done: this.#wait(startsIn + clipMs + this.#slackMs),
    };
  }

  /** Silence now: the queue, the waiters, and whatever the body has buffered. */
  hush() {
    this.#queue = [];
    this.#sentUntil = this.#now();
    for (const finish of [...this.#waiting]) finish();
    this.#send({ type: 'hush' });
  }

  /** @param {number} ms */
  #wait(ms) {
    return new Promise((resolve) => {
      let cancel = () => {};
      const finish = () => { this.#waiting.delete(finish); cancel(); resolve(undefined); };
      this.#waiting.add(finish);
      cancel = this.#after(ms, finish);
    });
  }

  #pump() {
    const now = this.#now();
    if (this.#sentUntil < now) this.#sentUntil = now;
    while (this.#queue.length > 0 && this.#sentUntil - now < LEAD_MS) {
      const chunk = /** @type {Int16Array} */ (this.#queue.shift());
      this.#sendAudio(int16ToBytes(chunk));
      this.#sentUntil += chunk.length / SAMPLES_PER_MS;
    }
    if (this.#queue.length > 0 && !this.#pumpQueued) {
      this.#pumpQueued = true;
      this.#after(CHUNK_MS, () => { this.#pumpQueued = false; this.#pump(); });
    }
  }
}

// The executor brain.js and session.js already talk to, for a body that is
// somewhere else.
//
// A body only ever obeys bounded orders (server/body split spec §3), so an
// unbounded cruise is the brain's job: it sends MAX_MOVE_MS at a time and
// renews LEAD_MS before each runs out — executor.js's renewal loop, with a
// message where that one has a USB write. If the brain dies, the body runs
// out of order within a second; if the link dies, the body's watchdog stops
// it sooner.
//
// Calibration (which wire is "left") is not here. It describes one car's
// wiring, so it lives on that car's body.

import { MAX_MOVE_MS } from '../../web/protocol.js';
import { LEAD_MS } from '../../web/motion.js';

const realSleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

export class RemoteExecutor {
  #send; #sleep; #now;
  #gen = 0;
  #connected;

  /**
   * @param {(msg: object) => void} send
   * @param {{ sleep?: (ms: number) => Promise<void>, now?: () => number, connected?: boolean }} [opts]
   */
  constructor(send, opts = {}) {
    this.#send = send;
    this.#sleep = opts.sleep ?? realSleep;
    this.#now = opts.now ?? (() => performance.now());
    this.#connected = opts.connected ?? true;
  }

  get connected() { return this.#connected; }

  /** Losing the motors kills every running loop, the way a USB fault does. */
  set connected(value) {
    this.#connected = value;
    if (!value) this.#gen++;
  }

  get generation() { return this.#gen; }

  /** @param {Array<{ drive: string, steer: string, duration_ms: number }>} steps */
  async move(steps) {
    if (!this.#connected) return;
    const gen = ++this.#gen;
    for (const step of steps) {
      if (gen !== this.#gen) return;
      await this.#run(gen, step.drive, step.steer, step.duration_ms);
    }
  }

  /** @param {string} drive @param {string} steer */
  async cruise(drive, steer) {
    if (!this.#connected) return;
    await this.#run(++this.#gen, drive, steer, null);
  }

  /** The bump is synchronous so every loop is dead before anything else runs. */
  stop() {
    this.#gen++;
    this.#send({ type: 'stop' });
    return Promise.resolve();
  }

  /**
   * @param {number} gen @param {string} drive @param {string} steer
   * @param {number | null} total null = cruise
   */
  async #run(gen, drive, steer, total) {
    const start = this.#now();
    for (;;) {
      if (gen !== this.#gen) return;
      // Measured from the clock, not by subtracting slices: a renewal sent
      // LEAD_MS early REPLACES the order still running on the body, so it
      // must cover what is left from now, not another full slice.
      const left = total === null ? Infinity : total - (this.#now() - start);
      if (left <= 0) return;
      const ms = Math.max(1, Math.round(Math.min(left, MAX_MOVE_MS)));
      this.#send({ type: 'move', drive, steer, ms });
      const last = left <= MAX_MOVE_MS;
      await this.#sleep(last ? ms : ms - LEAD_MS);
      if (last) return;
    }
  }
}

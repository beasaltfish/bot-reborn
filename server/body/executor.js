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

import { MAX_MOVE_MS } from '../../core/protocol.js';
import { LEAD_MS } from '../../core/motion.js';

const realSleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * How long an IO op may wait for its answer when the op itself carries no
 * bound. `core/io-program.js` puts the command's `timeoutMs` on every op it
 * expands, reads included, so this is only for an op sent by hand (a test, an
 * instrument). As long as the longest command the vocabulary allows (5000 ms),
 * so a legitimate write on a slow body is never cut short.
 */
export const IO_TIMEOUT_MS = 5000;

/**
 * Slack on top of the op's own timeout. The body stops the op itself at
 * `timeoutMs`; this is the link's share of the wait — one round trip plus a
 * scheduling hiccup. Past it the answer is not late, it is lost.
 */
const IO_SLACK_MS = 200;

/**
 * The wire's id is one byte (body plugins design: `cmd` ids are 1..255), so the
 * allocator wraps. Wrapping is only safe because an id still in the map is
 * skipped: reusing one would let an answer for the old op settle the new call.
 */
const MAX_IO_ID = 255;

/** @typedef {{ resolve: (value: unknown) => void, reject: (err: Error) => void, timer: ReturnType<typeof setTimeout> | null }} Pending */

/**
 * The IO half of the link (body plugins spec §5): one `cmd` out, one `result`
 * back, matched by an id the carrier hands out.
 *
 * Ids are this class's own counter and pending calls live in this class's own
 * map — never the motion generation, which moves on every order and would let
 * a late answer settle an unrelated op.
 *
 * The design allows at most four ops in flight on one body; that bound is the
 * caller's (Task 5 awaits each op before starting the next), not this carrier's
 * — it does not queue, it only refuses when all 255 ids are somehow taken.
 */
export class IoExecutor {
  #send; #connected;
  /** @type {Map<number, Pending>} */ #pending = new Map();
  #nextId = 1;

  /**
   * @param {{ send(msg: object): void }} conn
   * @param {{ connected?: boolean }} [opts]
   */
  constructor(conn, opts = {}) {
    this.#send = (/** @type {object} */ msg) => conn.send(msg);
    this.#connected = opts.connected ?? true;
  }

  get connected() { return this.#connected; }

  /** A body that is gone answers nothing: settle the waiters now, not at their timeout. */
  set connected(value) {
    this.#connected = value;
    if (!value) this.abort();
  }

  /**
   * The next id that is not still waiting for an answer: 1..255, wrapping, and
   * never one already in the map. `null` means every id is out, which the
   * caller's serial dispatch makes unreachable — refusing is still the only
   * honest answer.
   * @returns {number | null}
   */
  #allocateId() {
    for (let tries = 0; tries < MAX_IO_ID; tries++) {
      if (this.#nextId > MAX_IO_ID) this.#nextId = 1;
      const id = this.#nextId++;
      if (!this.#pending.has(id)) return id;
    }
    return null;
  }

  /**
   * One op, answered by the body or not at all.
   * @param {import('../../core/io-program.js').Op} op
   * @returns {Promise<unknown>}
   */
  io(op) {
    if (!this.#connected) return Promise.reject(new Error('disconnected'));
    const id = this.#allocateId();
    if (id === null) return Promise.reject(new Error('busy'));

    /** @type {Pending} */
    const entry = /** @type {any} */ ({});
    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
      entry.timer = null;
    });
    // The entry is in the map before the send: a fake (or a loopback link) may
    // answer inside send itself, and the answer must find its waiter.
    this.#pending.set(id, entry);

    try {
      this.#send({ type: 'cmd', id, op: op.op, args: op.args, safe: op.safe, timeoutMs: op.timeoutMs });
    } catch (error) {
      this.#pending.delete(id);
      entry.reject(/** @type {Error} */ (error));
      return promise;
    }
    if (!this.#pending.has(id)) return promise;

    const bound = typeof op.timeoutMs === 'number' && Number.isFinite(op.timeoutMs)
      ? op.timeoutMs : IO_TIMEOUT_MS;
    entry.timer = setTimeout(() => {
      if (!this.#pending.delete(id)) return;
      entry.reject(new Error('timeout'));
    }, bound + IO_SLACK_MS);
    return promise;
  }

  /**
   * The body's answer. An id nobody is waiting for is ignored in silence: a
   * late answer after a timeout is normal, not a fault.
   * @param {{ id?: unknown, ok?: unknown, value?: unknown, error?: unknown }} msg
   */
  onResult(msg) {
    const id = /** @type {number} */ (msg?.id);
    const entry = this.#pending.get(id);
    if (!entry) return;
    this.#pending.delete(id);
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.value);
    else entry.reject(new Error(String(msg.error ?? 'io failed')));
  }

  /**
   * Give up every pending op. `stop()` calls this: an order that was already
   * abandoned must not keep a turn waiting, and its answer, when it comes, is
   * for nobody.
   */
  abort() {
    for (const entry of this.#pending.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.reject(new Error('disconnected'));
    }
    this.#pending.clear();
  }
}

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

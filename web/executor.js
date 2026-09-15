// Actions → byte buffers, with the renewal loop and generation preemption of
// spec §4.3–§4.6. This module never touches the DOM and never decides *what*
// to do — brain.js does that. It only guarantees the car stops.

import { Ftdi } from './ftdi.js';

/** Longest the car may coast with nobody in control (spec §4.3). */
export const MAX_COAST_MS = 1000;

/** How early the next slice is queued so the car does not stutter (spec §4.3). */
export const LEAD_MS = 300;

/**
 * Shortest action the executor will emit.
 *
 * PLACEHOLDER pending calibration item ⑧ (spec §12) — this is the *motor's*
 * static-friction threshold, not yet measured. If ⑧ measures a threshold above
 * 300, raise this.
 *
 * It is NOT coupled to LEAD_MS, whatever spec §6.6 says. That claim rested on
 * `sleep(slice - LEAD_MS)` going negative below LEAD_MS, and it was only ever
 * true of the *first* slice: the slicer emits the remainder as the last slice,
 * so any total in (MAX_COAST_MS, MAX_COAST_MS + LEAD_MS) — move(1200), say —
 * produced a sub-LEAD_MS final slice however high this floor was. The renewal
 * loop below now waits on the tracked queue and clamps at zero, which is what
 * actually removes the negative sleep. Raising or lowering this bound cannot
 * reintroduce it.
 */
export const MIN_DURATION_MS = 300;

/** Spec §3.2. There is deliberately no `none` — see §3.3. */
export const DRIVE_BITS = /** @type {const} */ ({ forward: 0x10, backward: 0x20 });

/**
 * Spec §3.2. Which side of the steering coil is "left" comes from calibration
 * item ① — see docs/hardware.md. Swapping these two values is the entire fix
 * if the car turns the wrong way.
 */
export const STEER_BITS = /** @type {const} */ ({ left: 0x40, right: 0x80, straight: 0x00 });

/**
 * @param {string} drive
 * @param {string} steer
 * @returns {number}
 */
export function pinsFor(drive, steer) {
  const d = DRIVE_BITS[/** @type {keyof typeof DRIVE_BITS} */ (drive)];
  if (d === undefined) throw new RangeError(`unknown drive "${drive}"`);
  const s = STEER_BITS[/** @type {keyof typeof STEER_BITS} */ (steer)];
  if (s === undefined) throw new RangeError(`unknown steer "${steer}"`);
  return d | s;
}

const defaultSleep = (/** @type {number} */ ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class Executor {
  #ftdi;
  #sleep;
  #onError;
  #gen = 0;
  #connected = true;

  /**
   * Milliseconds of pin data handed to the chip that it has not clocked out
   * yet — the write-ahead the renewal loop is carrying.
   *
   * This is per-executor, not per-`#renew` call, deliberately: a multi-step
   * `move` re-enters `#renew` once per step, and per-call state would let the
   * write-ahead re-accumulate at every step boundary. It is only ever reset
   * where the queue is genuinely gone: after `stop()`'s purge, and in
   * `#fail()`.
   */
  #queuedMs = 0;

  /**
   * @param {Ftdi} ftdi
   * @param {{ sleep?: (ms: number) => Promise<void>, onError?: (err: Error) => void }} [opts]
   */
  constructor(ftdi, opts = {}) {
    this.#ftdi = ftdi;
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#onError = opts.onError ?? (() => {});
    ftdi.onDisconnect = (err) => this.#fail(err);
  }

  get connected() { return this.#connected; }

  /** Exposed for tests and for asserting preemption; do not write to it. */
  get generation() { return this.#gen; }

  /**
   * @param {Array<{ drive: string, steer: string, duration_ms: number }>} steps
   */
  async move(steps) {
    if (!this.#connected) return;
    const gen = ++this.#gen;
    for (const step of steps) {
      if (gen !== this.#gen) return;
      await this.#renew(gen, pinsFor(step.drive, step.steer), step.duration_ms);
      if (!this.#connected) return;
    }
  }

  /** @param {string} drive @param {string} steer */
  async cruise(drive, steer) {
    if (!this.#connected) return;
    const gen = ++this.#gen;
    await this.#renew(gen, pinsFor(drive, steer), null);
  }

  /**
   * Spec §4.4 — the three steps, in an order that is not negotiable.
   *
   * The generation bump is synchronous so that every running renewal loop is
   * already dead before the first await. The two USB operations must then be
   * awaited in sequence: purgeTx is a CONTROL transfer and the 0x00 is a BULK
   * transfer, so they travel different pipes and the browser gives us no
   * ordering guarantee between them. Submitting both without awaiting would let
   * the 0x00 land *before* the purge and be thrown away with everything else.
   *
   * @returns {Promise<void>} resolves once the pins are actually low
   */
  stop() {
    this.#gen++;
    return (async () => {
      await this.#ftdi.purgeTx();
      // The purge threw away everything the chip had queued, so the write-ahead
      // accounting starts from nothing again. (The 0x00 below is a single byte,
      // not a slice — it is not worth accounting for.)
      this.#queuedMs = 0;
      await this.#ftdi.write(new Uint8Array([0x00]));
    })().catch((err) => this.#fail(err));
  }

  /**
   * @param {number} gen
   * @param {number} pins
   * @param {number | null} totalMs null = cruise
   */
  async #renew(gen, pins, totalMs) {
    let remaining = totalMs;
    while (remaining === null || remaining > 0) {
      if (gen !== this.#gen) return;
      const slice = remaining === null ? MAX_COAST_MS : Math.min(remaining, MAX_COAST_MS);
      try {
        // One transferOut, stop byte already inside — spec §4.2.
        await this.#ftdi.write(this.#ftdi.buildStream(pins, slice));
      } catch (err) {
        this.#fail(/** @type {Error} */ (err));
        return;
      }
      // The write above is an await, so by the time it resolves this loop may
      // already be dead — stop() bumps the generation and zeroes #queuedMs
      // synchronously, and that can happen while the URB is in flight. Crediting
      // this slice afterwards hands the NEXT action a queue it never had, and it
      // oversleeps by exactly that much. The check at the top of the loop cannot
      // catch it: the preemption happened after that check had already run.
      if (gen !== this.#gen) return;
      this.#queuedMs += slice;
      if (remaining !== null) remaining -= slice;

      // Renew LEAD_MS before the QUEUE runs dry — not LEAD_MS before the slice
      // we just wrote would have finished on its own. Those two coincide only
      // on the first slice; from the second, the queue already carries a
      // LEAD_MS head start, and sleeping `slice - LEAD_MS` hands the chip
      // another LEAD_MS of write-ahead every single slice, forever. That is the
      // defect in spec §4.3's pseudocode: it makes MAX_COAST_MS — the one
      // safety parameter — stop bounding how far the car travels with nobody in
      // control, and it lets a bulk URB already in flight land *behind*
      // stop()'s purge and re-inject drive bytes.
      //
      // Waiting the whole queue down to LEAD_MS instead keeps the write-ahead
      // at MAX_COAST_MS + LEAD_MS whatever happens. Math.max(0, …) covers the
      // final slice of a total like 1200 ms, whose 200 ms remainder is smaller
      // than LEAD_MS and must not sleep a negative amount.
      const wait = Math.max(0, this.#queuedMs - LEAD_MS);
      this.#queuedMs -= wait;
      await this.#sleep(wait);
    }
  }

  /**
   * Spec §4.6: bump the generation, report, go to DISCONNECTED. Never retry —
   * a retry means the car is still going while we try again.
   * @param {Error} err
   */
  #fail(err) {
    this.#gen++;
    this.#queuedMs = 0;
    this.#connected = false;
    this.#onError(err);
  }
}

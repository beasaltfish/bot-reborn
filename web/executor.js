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
 * static-friction threshold, not yet measured. It is also an INVARIANT, not a
 * policy (spec §6.6): the renewal loop's `sleep(slice - LEAD_MS)` goes negative
 * below LEAD_MS, so this bound and LEAD_MS are coupled and cannot be changed
 * independently. If ⑧ measures a threshold above 300, raise this AND re-check
 * LEAD_MS together.
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
      if (remaining !== null) remaining -= slice;
      await this.#sleep(slice - LEAD_MS);
    }
  }

  /**
   * Spec §4.6: bump the generation, report, go to DISCONNECTED. Never retry —
   * a retry means the car is still going while we try again.
   * @param {Error} err
   */
  #fail(err) {
    this.#gen++;
    this.#connected = false;
    this.#onError(err);
  }
}

// The executors for a character whose body does not drive (body motion spec
// §3). Both have RemoteExecutor's shape, so brain.js and session.js cannot
// tell them from a car — which is the point of a dry run.

/** @typedef {{ drive: string, steer: string, duration_ms: number }} Step */

/**
 * Writes down what a car would have done, and does it instantly: what a dry
 * run tests is which move was chosen, not how long the car would take.
 */
export class DryRunExecutor {
  #log;
  #gen = 0;
  #connected = true;
  #cruising = false;

  /** @param {(line: string) => void} log */
  constructor(log) { this.#log = log; }

  get connected() { return this.#connected; }

  /** The body leaving ends the run, the way it kills a car's loops. */
  set connected(value) {
    this.#connected = value;
    if (!value) { this.#gen++; this.#cruising = false; }
  }

  get generation() { return this.#gen; }

  /** @param {Step[]} steps */
  async move(steps) {
    if (!this.#connected) return;
    this.#gen++;
    this.#cruising = false;
    this.#log(`dry-run: move ${steps.map((s) => `${s.drive}/${s.steer} ${s.duration_ms}ms`).join(', ')}`);
  }

  /** @param {string} drive @param {string} steer */
  async cruise(drive, steer) {
    if (!this.#connected) return;
    this.#gen++;
    this.#cruising = true;
    this.#log(`dry-run: cruise ${drive}/${steer}`);
  }

  /**
   * Said only when a cruise was running (spec §4.1 ⑤): the session brakes on
   * every doze and timeout, and braking a car that is standing still does
   * nothing, so a line for it would only bury the orders being tested.
   */
  stop() {
    this.#gen++;
    if (this.#cruising) this.#log('dry-run: stop');
    this.#cruising = false;
    return Promise.resolve();
  }
}

/** A body with no wheels: the LLM is not offered moving, and this swallows the rest. */
export class NoMotionExecutor {
  #gen = 0;
  #connected = true;
  get connected() { return this.#connected; }
  set connected(value) { this.#connected = value; if (!value) this.#gen++; }
  get generation() { return this.#gen; }
  /** @param {Step[]} _steps */
  async move(_steps) {}
  /** @param {string} _drive @param {string} _steer */
  async cruise(_drive, _steer) {}
  stop() { this.#gen++; return Promise.resolve(); }
}

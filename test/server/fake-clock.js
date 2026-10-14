// A clock the test moves by hand. `advance` runs due timers in order and
// lets promise continuations settle between them, so code that awaits a
// sleep and then sends something is observed at the right instant.

export class FakeClock {
  t = 0;
  /** @type {{ at: number, seq: number, fn: () => void }[]} */ #timers = [];
  #seq = 0;

  now = () => this.t;

  /** @param {number} ms @param {() => void} fn @returns {() => void} */
  after = (ms, fn) => {
    const timer = { at: this.t + ms, seq: this.#seq++, fn };
    this.#timers.push(timer);
    return () => { this.#timers = this.#timers.filter((x) => x !== timer); };
  };

  /** @param {number} ms */
  sleep = (ms) => new Promise((resolve) => { this.after(ms, () => resolve(undefined)); });

  /** @param {number} ms */
  async advance(ms) {
    const end = this.t + ms;
    for (;;) {
      await new Promise((r) => setImmediate(r));
      this.#timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.#timers[0];
      if (!next || next.at > end) break;
      this.#timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
    await new Promise((r) => setImmediate(r));
  }
}

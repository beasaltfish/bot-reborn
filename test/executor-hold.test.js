import test from 'node:test';
import assert from 'node:assert/strict';
import { Executor, pinsFor } from '../phone/executor.js';

/**
 * A chip that plays 1 byte per ms, a clock that moves only when the executor
 * sleeps, and a hook to run something at the end of the next sleep — which is
 * where a brain's renewal lands: LEAD_MS before the order runs out.
 */
function chip() {
  let now = 0;
  let drainUntil = 0;
  /** @type {Array<{ at: number, ms: number, pin: number }>} */ const writes = [];
  /** @type {Array<() => void>} */ const atSleep = [];
  /** @type {any} */
  const ftdi = {
    /** @param {number} pin @param {number} ms */
    buildStream(pin, ms) {
      const n = Math.max(1, Math.round(ms));
      const s = new Uint8Array(n + 1);
      s.fill(pin, 0, n);
      return s;
    },
    /** @param {Uint8Array} bytes */
    async write(bytes) {
      const ms = bytes.length - 1;
      writes.push({ at: now, ms, pin: bytes[0] });
      drainUntil = Math.max(drainUntil, now) + ms;
    },
    async purgeTx() { drainUntil = now; },
  };
  return {
    writes,
    /** When the chip runs out of bytes: the moment the car stops. */
    get stopsAt() { return drainUntil; },
    /** @param {() => void} fn */
    atNextSleep(fn) { atSleep.push(fn); },
    make() {
      return new Executor(ftdi, {
        now: () => now,
        sleep: async (ms) => { now += ms; atSleep.shift()?.(); },
      });
    },
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test('hold(): a renewal in the same direction moves the deadline, it does not queue behind the chip', async () => {
  const c = chip();
  const ex = c.make();
  // The brain's cruise: 1000 ms, renewed LEAD_MS (300) before it runs out with 1000 more.
  c.atNextSleep(() => ex.hold('forward', 'straight', 1000));
  ex.hold('forward', 'straight', 1000);
  await settle();
  // Renewed at 700 for 1000 → the car stops at 1700. Queued, it would be 2000.
  assert.equal(c.stopsAt, 1700);
});

test('hold(): a different direction replaces what the chip still holds, now', async () => {
  const c = chip();
  const ex = c.make();
  c.atNextSleep(() => ex.hold('forward', 'left', 500));
  ex.hold('forward', 'straight', 1000);
  await settle();
  const left = pinsFor('forward', 'left');
  assert.equal(c.writes.at(-1)?.pin, left);
  assert.equal(c.writes.at(-1)?.at, 700);
  assert.equal(c.stopsAt, 1200);
});

test('hold(): stop() ends it, and the next hold starts a fresh order', async () => {
  const c = chip();
  const ex = c.make();
  c.atNextSleep(() => { void ex.stop(); });
  ex.hold('forward', 'straight', 1000);
  await settle();
  assert.equal(c.stopsAt, 700);
  const before = c.writes.length;
  ex.hold('forward', 'straight', 400);
  await settle();
  assert.equal(c.writes.length, before + 1);
  assert.equal(c.stopsAt, 700 + 400);
});

test('hold(): a renewal after the order already ran out starts again rather than vanishing', async () => {
  const c = chip();
  const ex = c.make();
  ex.hold('forward', 'straight', 300);
  await settle();
  const before = c.writes.length;
  ex.hold('forward', 'straight', 300);
  await settle();
  assert.equal(c.writes.length, before + 1, 'the second order was dropped');
});

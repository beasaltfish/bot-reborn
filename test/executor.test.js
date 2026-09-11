import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Executor, pinsFor, DRIVE_BITS, STEER_BITS,
  MAX_COAST_MS, LEAD_MS, MIN_DURATION_MS,
} from '../web/executor.js';

/**
 * A fake Ftdi plus a fake clock.
 *
 * `sleep` never actually waits: it records the requested duration and hands
 * back a promise we resolve by hand. That makes every timing assertion below
 * exact and instant — and, more importantly, lets a test preempt a running
 * renewal loop at a precisely known point.
 */
function harness({ bytesPerMs = 0.5 } = {}) {
  /** @type {any[]} */
  const log = [];
  /** @type {((v?: any) => void) | null} */
  let pending = null;

  // A plain duck-typed fake: Ftdi is a class with private fields, so this can
  // never structurally satisfy the `Ftdi` type tsc expects — cast it once here
  // rather than scattering casts at every call site.
  /** @type {any} */
  const ftdi = {
    bytesPerMs,
    /** @param {number} pinByte @param {number} ms */
    buildStream(pinByte, ms) {
      const n = Math.max(1, Math.round(ms * bytesPerMs));
      const s = new Uint8Array(n + 1);
      s.fill(pinByte, 0, n);
      return s;
    },
    /** @param {any} bytes */
    async write(bytes) {
      log.push({ op: 'write', pin: bytes[0], length: bytes.length, tail: bytes[bytes.length - 1] });
    },
    async purgeTx() { log.push({ op: 'purgeTx' }); },
  };

  /** @param {number} ms */
  const sleep = (ms) => {
    log.push({ op: 'sleep', ms });
    return new Promise((resolve) => { pending = resolve; });
  };

  // A single `await Promise.resolve()` is NOT enough to let the executor run
  // to its next sleep: each `await` inside an async function costs its own
  // microtask turn, so the test's continuation can be scheduled ahead of the
  // executor's. Draining a fixed number of turns makes every assertion below
  // deterministic instead of order-of-scheduling dependent.
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  return {
    log, ftdi, flush,
    /** Let the executor past its current sleep, then run it to the next one. */
    async tick() { const r = pending; pending = null; r?.(); await flush(); },
    /** @param {{ sleep?: (ms: number) => Promise<void>, onError?: (err: Error) => void }} [opts] */
    make(opts = {}) { return new Executor(ftdi, { sleep, ...opts }); },
  };
}

/**
 * A fake that models the CHIP instead of the call log.
 *
 * `now` advances only when the executor sleeps; `drainUntil` is when the chip
 * would finish clocking out everything it has been handed. The gap between
 * them is the write-ahead — how long the car keeps driving with nobody in
 * control — which is exactly the quantity MAX_COAST_MS claims to bound and the
 * one no call-log assertion can see.
 *
 * @param {{ bytesPerMs?: number }} [opts]
 */
function chipHarness({ bytesPerMs = 0.5 } = {}) {
  let now = 0;
  let drainUntil = 0;
  /** @type {number[]} */ const backlogs = [];
  /** @type {number[]} */ const sleeps = [];
  /** @type {(() => void) | null} */ let onWrite = null;

  /** @type {any} */
  const ftdi = {
    bytesPerMs,
    /** @param {number} pinByte @param {number} ms */
    buildStream(pinByte, ms) {
      const n = Math.max(1, Math.round(ms * bytesPerMs));
      const s = new Uint8Array(n + 1);
      s.fill(pinByte, 0, n);
      return s;
    },
    /** @param {any} bytes */
    async write(bytes) {
      // Recover the duration the way the chip sees it: from the bytes, minus
      // the trailing stop byte.
      const ms = (bytes.length - 1) / bytesPerMs;
      drainUntil = Math.max(drainUntil, now) + ms;
      backlogs.push(drainUntil - now);
      onWrite?.();
    },
    async purgeTx() { drainUntil = now; },
  };

  /** @param {number} ms */
  const sleep = async (ms) => { sleeps.push(ms); now += ms; };

  return {
    ftdi, sleep, backlogs, sleeps,
    /** @param {() => void} fn */
    setOnWrite(fn) { onWrite = fn; },
    /** @param {{ sleep?: (ms: number) => Promise<void> }} [opts] */
    make(opts = {}) { return new Executor(ftdi, { sleep, ...opts }); },
  };
}

test('pinsFor(): combines drive and steer by bitwise or (spec §3.2)', () => {
  assert.equal(DRIVE_BITS.forward, 0x10);
  assert.equal(DRIVE_BITS.backward, 0x20);
  assert.equal(STEER_BITS.straight, 0x00);
  assert.equal(pinsFor('forward', 'straight'), 0x10);
  // A 侧 = 0x40, B 侧 = 0x80; which one is "left" comes from item ① and lives
  // in STEER_BITS, so assert on the *set* rather than on a guessed direction.
  assert.deepEqual(
    [STEER_BITS.left, STEER_BITS.right].sort((a, b) => a - b),
    [0x40, 0x80],
  );
  assert.equal(pinsFor('forward', 'left'), 0x10 | STEER_BITS.left);
});

test('pinsFor(): there is no drive:none (spec §3.3)', () => {
  assert.equal(/** @type {any} */ (DRIVE_BITS).none, undefined);
  assert.throws(() => pinsFor('none', 'left'), /drive/);
  assert.throws(() => pinsFor('forward', 'sideways'), /steer/);
});

test('move(): a short step is one write whose stream ends in the stop byte', async () => {
  const h = harness();
  const ex = h.make();
  const done = ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 600 }]);
  await h.flush();

  assert.deepEqual(h.log[0], { op: 'write', pin: 0x10, length: 301, tail: 0x00 });
  // The queue was empty, so it now holds 600 ms and we wait it down to LEAD_MS.
  // The first slice is the ONE case where that equals `slice - LEAD_MS`.
  assert.deepEqual(h.log[1], { op: 'sleep', ms: 600 - LEAD_MS });
  await h.tick();
  await done;
});

test('move(): a long step is sliced at MAX_COAST_MS and renewed before the QUEUE drains', async () => {
  const h = harness();
  const ex = h.make();
  const done = ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 2500 }]);
  await h.flush();

  // Every wait leaves exactly LEAD_MS of write-ahead in the chip — that is what
  // "renew LEAD_MS early" means, and it is NOT `slice - LEAD_MS` after the
  // first slice: from then on the queue already carries that head start, and
  // sleeping `slice - LEAD_MS` would add another LEAD_MS every slice, forever.

  // slice 1: queue was empty → 1000 queued, wait it down to LEAD_MS
  assert.equal(h.log[0].op, 'write');
  assert.equal(h.log[1].ms, MAX_COAST_MS - LEAD_MS);
  await h.tick();
  // slice 2: LEAD_MS was still queued → 1300 queued, so the wait is a full slice
  assert.equal(h.log[2].op, 'write');
  assert.equal(h.log[3].ms, MAX_COAST_MS);
  await h.tick();
  // slice 3: the 500 ms remainder on top of LEAD_MS → 800 queued, wait 500
  assert.equal(h.log[4].op, 'write');
  assert.equal(h.log[4].length, Math.round(500 * 0.5) + 1);
  assert.equal(h.log[5].ms, 500);
  await h.tick();
  await done;

  assert.equal(h.log.filter((e) => e.op === 'write').length, 3);
  // Total sleep = total motion: the loop keeps pace with the car instead of
  // running ahead of it.
  assert.equal(h.log.filter((e) => e.op === 'sleep').reduce((a, e) => a + e.ms, 0),
    2500 - LEAD_MS);
});

test('no step duration ever sleeps a negative amount', async () => {
  // The old version of this test only exercised the MIN_DURATION_MS floor,
  // where the sleep is 0 — its assertion could not observe the property its
  // name claimed. The durations that actually went negative were the ones just
  // above MAX_COAST_MS: the slicer emits the remainder as the final slice, and
  // that remainder lands anywhere in [1, LEAD_MS).
  for (const duration of [MIN_DURATION_MS, 1200, MAX_COAST_MS + 1,
    MAX_COAST_MS + LEAD_MS - 1, 2 * MAX_COAST_MS + 1]) {
    const h = harness();
    const ex = h.make();
    const done = ex.move([{ drive: 'forward', steer: 'straight', duration_ms: duration }]);
    await h.flush();
    for (let i = 0; i < 8; i++) await h.tick();
    await done;

    const sleeps = h.log.filter((e) => e.op === 'sleep').map((e) => e.ms);
    assert.ok(sleeps.every((ms) => ms >= 0),
      `move(${duration}) slept a negative amount: ${JSON.stringify(sleeps)}`);
  }
});

test('cruise(): renews forever until something bumps the generation', async () => {
  const h = harness();
  const ex = h.make();
  ex.cruise('forward', 'straight');
  await h.flush();

  for (let i = 0; i < 3; i++) {
    assert.equal(h.log[i * 2].op, 'write');
    // First wait drains an empty-queue slice; every later one keeps the
    // write-ahead pinned at LEAD_MS instead of growing it.
    assert.equal(h.log[i * 2 + 1].ms, i === 0 ? MAX_COAST_MS - LEAD_MS : MAX_COAST_MS);
    await h.tick();
  }
  assert.equal(h.log.filter((e) => e.op === 'write').length, 4);

  await ex.stop();
  await h.tick();
  const writesAtStop = h.log.filter((e) => e.op === 'write').length;
  await h.tick();
  assert.equal(h.log.filter((e) => e.op === 'write').length, writesAtStop,
    'the renewal loop must be dead after stop()');
});

test('stop(): purgeTx completes BEFORE the 0x00 write (spec §4.4)', async () => {
  const h = harness();
  const ex = h.make();
  await ex.stop();

  const ops = h.log.map((e) => e.op);
  const purge = ops.indexOf('purgeTx');
  const write = ops.indexOf('write');
  assert.ok(purge !== -1 && write !== -1);
  assert.ok(purge < write,
    'purgeTx is a CONTROL transfer and the 0x00 is a BULK transfer — different ' +
    'pipes, so the browser does not order them for us. They must be awaited in order.');
  assert.deepEqual(h.log[write], { op: 'write', pin: 0x00, length: 1, tail: 0x00 });
});

test('stop(): bumps the generation synchronously, before any await', () => {
  const h = harness();
  const ex = h.make();
  ex.cruise('forward', 'straight');
  const promise = ex.stop();   // not awaited
  assert.equal(ex.generation, 2, 'generation must move before the first await');
  return promise;
});

test('a second command preempts the first (spec §4.5)', async () => {
  const h = harness();
  const ex = h.make();
  ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 5000 }]);
  await h.flush();
  const before = h.log.filter((e) => e.op === 'write').length;

  ex.move([{ drive: 'backward', steer: 'straight', duration_ms: 600 }]);
  await h.flush();
  await h.tick();   // release the *first* loop's sleep; it must see a new gen and die

  const writes = h.log.filter((e) => e.op === 'write');
  assert.equal(writes.length, before + 1);
  assert.equal(writes[writes.length - 1].pin, 0x20, 'only the new command may write');
});

test('move(): a multi-step queue shares one generation and stops mid-queue on preempt', async () => {
  const h = harness();
  const ex = h.make();
  ex.move([
    { drive: 'forward', steer: 'straight', duration_ms: 600 },
    { drive: 'forward', steer: 'left', duration_ms: 600 },
    { drive: 'backward', steer: 'straight', duration_ms: 600 },
  ]);
  await h.flush();
  assert.equal(h.log[0].pin, 0x10);
  await h.tick();
  assert.equal(h.log[2].pin, 0x10 | STEER_BITS.left);

  await ex.stop();
  await h.tick();
  const writes = h.log.filter((e) => e.op === 'write' && e.pin !== 0x00);
  assert.equal(writes.length, 2, 'the third step must never be written');
});

test('a failed renewal write kills the loop and reports, and never retries (spec §4.6)', async () => {
  const h = harness();
  /** @type {Error[]} */
  const errors = [];
  const ex = h.make({ onError: (e) => errors.push(e) });

  h.ftdi.write = async () => { throw new Error('device disconnected'); };
  await ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 600 }]);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /disconnected/);
  assert.equal(ex.connected, false);
});

test('commands are refused once disconnected', async () => {
  const h = harness();
  const ex = h.make({ onError: () => {} });
  h.ftdi.write = async () => { throw new Error('boom'); };
  await ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 600 }]);

  const before = h.log.length;
  await ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 600 }]);
  assert.equal(h.log.length, before, 'a disconnected executor must not touch the bus');
});

// --- The write-ahead invariant (spec §4.3) ---------------------------------
//
// MAX_COAST_MS is described as the only safety parameter: how far the car may
// travel with nobody in control. That is a claim about the CHIP's queue, not
// about any number in the call log, and it held for one slice and then drifted
// by LEAD_MS per slice, forever, without a single test noticing. These two
// pin the real quantity.

test('cruising never queues more than MAX_COAST_MS + LEAD_MS ahead of real time', async () => {
  const h = chipHarness();
  const ex = h.make();
  // 60 slices ≈ a minute of cruising. The defect grew by LEAD_MS per slice, so
  // this would have reached 18 s of write-ahead — roughly 27 m of car.
  // (`stopping` guards against re-entry: stop()'s own 0x00 is a write too.)
  let stopping = false;
  h.setOnWrite(() => {
    if (stopping || h.backlogs.length < 60) return;
    stopping = true;
    ex.stop();
  });
  await ex.cruise('forward', 'straight');

  assert.ok(h.backlogs.length >= 60, 'the loop must actually have run');
  const worst = Math.max(...h.backlogs);
  assert.ok(worst <= MAX_COAST_MS + LEAD_MS,
    `write-ahead reached ${worst} ms, above the MAX_COAST_MS + LEAD_MS = ` +
    `${MAX_COAST_MS + LEAD_MS} bound — MAX_COAST_MS no longer bounds anything`);
});

test('a multi-step move does not re-accumulate write-ahead at each step boundary', async () => {
  // #renew is entered once per step, so per-call queue state would reset here
  // and let the backlog climb again — hence the per-executor field.
  const h = chipHarness();
  const ex = h.make();
  await ex.move(Array.from({ length: 8 }, (/** @type {any} */ _, i) => ({
    drive: i % 2 ? 'backward' : 'forward', steer: 'straight', duration_ms: 900,
  })));

  const worst = Math.max(...h.backlogs);
  assert.ok(worst <= MAX_COAST_MS + LEAD_MS,
    `write-ahead reached ${worst} ms across the queue, above ${MAX_COAST_MS + LEAD_MS}`);
});

test('stop() clears the write-ahead accounting, so the next command starts clean', async () => {
  const h = chipHarness();
  const ex = h.make();
  await ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 3000 }]);
  await ex.stop();
  h.backlogs.length = 0;
  h.sleeps.length = 0;

  const done = ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 600 }]);
  await done;
  // Had stop() left the pre-purge write-ahead on the books, this would wait for
  // bytes the purge already threw away, and the car would stutter.
  assert.deepEqual(h.sleeps, [600 - LEAD_MS]);
  assert.deepEqual(h.backlogs, [600]);
});

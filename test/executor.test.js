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
  assert.deepEqual(h.log[1], { op: 'sleep', ms: 600 - LEAD_MS });
  await h.tick();
  await done;
});

test('move(): a long step is sliced at MAX_COAST_MS and renewed LEAD_MS early', async () => {
  const h = harness();
  const ex = h.make();
  const done = ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 2500 }]);
  await h.flush();

  // slice 1
  assert.equal(h.log[0].op, 'write');
  assert.equal(h.log[1].ms, MAX_COAST_MS - LEAD_MS);
  await h.tick();
  // slice 2
  assert.equal(h.log[2].op, 'write');
  assert.equal(h.log[3].ms, MAX_COAST_MS - LEAD_MS);
  await h.tick();
  // slice 3: the 500 ms remainder
  assert.equal(h.log[4].op, 'write');
  assert.equal(h.log[4].length, Math.round(500 * 0.5) + 1);
  assert.equal(h.log[5].ms, 500 - LEAD_MS);
  await h.tick();
  await done;

  assert.equal(h.log.filter((e) => e.op === 'write').length, 3);
});

test('a step at the MIN_DURATION_MS floor never sleeps a negative amount', async () => {
  // This is the invariant of spec §6.6: the lower bound is coupled to LEAD_MS
  // precisely so that `slice - LEAD_MS` cannot go negative.
  assert.equal(MIN_DURATION_MS, LEAD_MS);
  const h = harness();
  const ex = h.make();
  const done = ex.move([{ drive: 'forward', steer: 'straight', duration_ms: MIN_DURATION_MS }]);
  await h.flush();
  assert.equal(h.log[1].ms, 0);
  await h.tick();
  await done;
});

test('cruise(): renews forever until something bumps the generation', async () => {
  const h = harness();
  const ex = h.make();
  ex.cruise('forward', 'straight');
  await h.flush();

  for (let i = 0; i < 3; i++) {
    assert.equal(h.log[i * 2].op, 'write');
    assert.equal(h.log[i * 2 + 1].ms, MAX_COAST_MS - LEAD_MS);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteExecutor } from '../../server/body/executor.js';
import { FakeClock } from './fake-clock.js';

function rig(connected = true) {
  const clock = new FakeClock();
  /** @type {any[]} */ const sent = [];
  const ex = new RemoteExecutor((m) => sent.push({ at: clock.t, ...m }),
    { sleep: clock.sleep, now: clock.now, connected });
  return { clock, sent, ex };
}

test('a short move is one bounded order and resolves when it ends', async () => {
  const { clock, sent, ex } = rig();
  let done = false;
  void ex.move([{ drive: 'forward', steer: 'left', duration_ms: 600 }]).then(() => { done = true; });
  await clock.advance(599);
  assert.equal(done, false);
  await clock.advance(1);
  assert.equal(done, true);
  assert.deepEqual(sent, [{ at: 0, type: 'move', drive: 'forward', steer: 'left', ms: 600 }]);
});

test('a long move is renewed early and the renewal covers only what is left', async () => {
  const { clock, sent, ex } = rig();
  void ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 1500 }]);
  await clock.advance(2000);
  assert.deepEqual(sent.map((m) => [m.at, m.ms]), [[0, 1000], [700, 800]]);
});

test('steps run in order', async () => {
  const { clock, sent, ex } = rig();
  void ex.move([
    { drive: 'forward', steer: 'straight', duration_ms: 400 },
    { drive: 'backward', steer: 'right', duration_ms: 300 },
  ]);
  await clock.advance(1000);
  assert.deepEqual(sent.map((m) => [m.at, m.drive, m.ms]), [[0, 'forward', 400], [400, 'backward', 300]]);
});

test('cruise renews every 700 ms until stop, and never orders more than 1000', async () => {
  const { clock, sent, ex } = rig();
  void ex.cruise('forward', 'straight');
  await clock.advance(1500);
  await ex.stop();
  await clock.advance(2000);
  assert.deepEqual(sent.map((m) => [m.at, m.type, m.ms]),
    [[0, 'move', 1000], [700, 'move', 1000], [1400, 'move', 1000], [1500, 'stop', undefined]]);
});

test('motors going away mid-cruise ends the renewals', async () => {
  const { clock, sent, ex } = rig();
  void ex.cruise('forward', 'straight');
  await clock.advance(100);
  ex.connected = false;
  await clock.advance(3000);
  assert.equal(sent.filter((m) => m.type === 'move').length, 1);
  assert.ok(sent.every((m) => m.type !== 'move' || m.ms <= 1000));
});

test('a new move preempts a running one', async () => {
  const { clock, sent, ex } = rig();
  void ex.cruise('forward', 'straight');
  await clock.advance(100);
  void ex.move([{ drive: 'backward', steer: 'left', duration_ms: 300 }]);
  await clock.advance(3000);
  assert.deepEqual(sent.map((m) => [m.at, m.drive]), [[0, 'forward'], [100, 'backward']]);
});

test('nothing is sent while the motors are disconnected', async () => {
  const { clock, sent, ex } = rig(false);
  await Promise.race([ex.move([{ drive: 'forward', steer: 'left', duration_ms: 600 }]), clock.advance(1000)]);
  assert.deepEqual(sent, []);
  assert.equal(ex.connected, false);
});

// --- IO ops ----------------------------------------------------------------
//
// One `cmd` out, one `result` back. The id is what pairs them; the motion
// generation is not (it moves on every order) and the answer may be late.

/** The executor's own sender, without the rig's clock stamp. */
function ioRig() {
  /** @type {any[]} */ const sent = [];
  const ex = new RemoteExecutor((m) => sent.push(m), { now: () => 0 });
  return { sent, ex };
}

test('io sends one cmd and resolves with the body result', async () => {
  const { sent, ex } = ioRig();
  const p = ex.io({ op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0, timeoutMs: 200 });
  assert.deepEqual(sent, [{
    type: 'cmd', id: 1, op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0, timeoutMs: 200,
  }]);
  ex.onResult({ id: 1, ok: true, value: null });
  assert.equal(await p, null);
});

test('io rejects when the body says no', async () => {
  const { ex } = ioRig();
  const p = ex.io({ op: 'i2c.read', args: {}, timeoutMs: 50 });
  ex.onResult({ id: 1, ok: false, error: 'unavailable' });
  await assert.rejects(p, /unavailable/);
});

test('io gives up after the op’s own timeout plus slack, and a late answer is ignored', async () => {
  const { sent, ex } = ioRig();
  const p = ex.io({ op: 'pin.read', args: { pin: 5 }, timeoutMs: 10 });
  await assert.rejects(p, /timeout/);
  assert.equal(sent[0].id, 1);
  // The answer arrives after the wait was given up on: normal, not a fault.
  assert.doesNotThrow(() => ex.onResult({ id: 1, ok: true, value: 1 }));
  // And the id is not reused, so the next op cannot be settled by it either.
  const next = ex.io({ op: 'pin.read', args: { pin: 5 }, timeoutMs: 50 });
  ex.onResult({ id: sent[1].id, ok: true, value: 0 });
  assert.equal(await next, 0);
});

test('an id nobody is waiting for settles nothing', async () => {
  const { ex } = ioRig();
  assert.doesNotThrow(() => ex.onResult({ id: 99, ok: true, value: 1 }));
  assert.doesNotThrow(() => ex.onResult({ ok: true }));
});

test('losing the link rejects every pending io at once, not at its timeout', async () => {
  const { ex } = ioRig();
  const first = assert.rejects(ex.io({ op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0, timeoutMs: 5000 }),
    /disconnected/);
  const second = assert.rejects(ex.io({ op: 'pin.read', args: { pin: 5 } }), /disconnected/);
  ex.connected = false;
  await Promise.all([first, second]);
  // And a disconnected carrier refuses new ops without touching the wire.
  await assert.rejects(ex.io({ op: 'pin.read', args: { pin: 5 } }), /disconnected/);
});

test('stop() abandons pending io, and the next op still works', async () => {
  const { ex } = ioRig();
  const pending = assert.rejects(ex.io({ op: 'pin.read', args: { pin: 5 }, timeoutMs: 5000 }), /disconnected/);
  await ex.stop();
  await pending;
  // A halt is not a disconnect: the body is still there for the next command.
  const next = ex.io({ op: 'pin.read', args: { pin: 5 }, timeoutMs: 5000 });
  ex.onResult({ id: 2, ok: true, value: 1 });
  assert.equal(await next, 1);
});


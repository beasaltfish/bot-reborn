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

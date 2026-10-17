import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DryRunExecutor, NoMotionExecutor } from '../../server/body/still.js';

const steps = [
  { drive: 'forward', steer: 'left', duration_ms: 600 },
  { drive: 'backward', steer: 'straight', duration_ms: 400 },
];

test('dry-run writes down each order instead of driving', async () => {
  /** @type {string[]} */ const lines = [];
  const ex = new DryRunExecutor((l) => lines.push(l));
  await ex.move(steps);
  await ex.cruise('forward', 'straight');
  await ex.stop();
  assert.deepEqual(lines, [
    'dry-run: move forward/left 600ms, backward/straight 400ms',
    'dry-run: cruise forward/straight',
    'dry-run: stop',
  ]);
});

test('dry-run says stop only when a cruise was running', async () => {
  // The session stops the car on every doze and every timeout. A car that is
  // not moving does nothing when braked, and a log that says it did buries
  // the orders being tested.
  /** @type {string[]} */ const lines = [];
  const ex = new DryRunExecutor((l) => lines.push(l));
  await ex.stop();
  await ex.move(steps);
  await ex.stop();
  assert.deepEqual(lines, ['dry-run: move forward/left 600ms, backward/straight 400ms']);
  await ex.cruise('backward', 'right');
  await ex.move(steps);           // a move replaces the cruise
  await ex.stop();
  assert.equal(lines.filter((l) => l === 'dry-run: stop').length, 0);
});

test('dry-run returns at once: what is tested is the choice, not the timing', async () => {
  const ex = new DryRunExecutor(() => {});
  const started = Date.now();
  await ex.move([{ drive: 'forward', steer: 'straight', duration_ms: 5000 }]);
  assert.ok(Date.now() - started < 100);
});

test('dry-run disconnected (the body left) writes nothing more', async () => {
  /** @type {string[]} */ const lines = [];
  const ex = new DryRunExecutor((l) => lines.push(l));
  ex.connected = false;
  await ex.move(steps);
  await ex.cruise('forward', 'straight');
  assert.deepEqual(lines, []);
});

test('no motion does nothing, and has the same shape', async () => {
  const ex = new NoMotionExecutor();
  assert.equal(ex.connected, true);
  await ex.move(steps);
  await ex.cruise('forward', 'straight');
  await ex.stop();
  ex.connected = false;
  assert.equal(ex.connected, false);
  assert.equal(typeof ex.generation, 'number');
});

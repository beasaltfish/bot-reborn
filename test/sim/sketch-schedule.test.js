import test from 'node:test';
import assert from 'node:assert/strict';
import { createSketchRunner } from '../../sim/firmware/sketch.js';

test('ticks at 10 Hz and applies the pin output before rendering', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const order = /** @type {string[]} */ ([]);
  const runner = createSketchRunner({
    firmware: /** @type {any} */ ({ id: 'x', tick: (/** @type {any} */ ctx) => { order.push('tick'); ctx.pin('GPIO5', 'high'); } }),
    ctx: () => ({ pin: (/** @type {string} */ pin, /** @type {string} */ level) => order.push(`${pin}:${level}`) }),
    render: () => order.push('render'),
  });
  runner.start();
  t.mock.timers.tick(100);
  assert.deepEqual(order, ['tick', 'GPIO5:high', 'render', 'tick', 'GPIO5:high', 'render']);
  runner.stop();
});

test('stop ends the schedule', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let ticks = 0;
  const runner = createSketchRunner({ firmware: /** @type {any} */ ({ id: 'x', tick: () => { ticks += 1; } }), ctx: () => ({}) });
  runner.start();
  runner.stop();
  t.mock.timers.tick(1000);
  assert.equal(ticks, 1);
});

test('the runner forwards machine records', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  /** @type {any[]} */ const seen = [];
  const runner = createSketchRunner({
    firmware: /** @type {any} */ ({ id: 'x', tick: () => [{ kind: 'statement', line: 1, text: 'x' }] }),
    ctx: () => ({}), onTrace: (r) => seen.push(...r),
  });
  runner.start(); t.mock.timers.tick(100); runner.stop();
  assert.equal(seen[0].line, 1);
});

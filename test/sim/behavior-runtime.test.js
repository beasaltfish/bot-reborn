// The local rule engine: level, edge and periodic rules, without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBehaviorRuntime } from '../../sim/behavior-runtime.js';
import { loadBenchBodies } from '../../sim/bench-bodies.js';

const button = loadBenchBodies().bodies['button-led'];

test('a held button turns the LED on once and off on release', () => {
  /** @type {string[]} */
  const calls = [];
  let level = /** @type {'low'|'high'} */ ('high');
  const runtime = createBehaviorRuntime({
    body: button,
    read: () => level,
    run: async (name) => { calls.push(name); },
  });
  runtime.start();
  level = 'low';
  runtime.tick(1);
  assert.deepEqual(calls, ['led_on']);
  runtime.tick(2);
  assert.deepEqual(calls, ['led_on'], 'a held button does not repeat');
  level = 'high';
  runtime.tick(3);
  assert.deepEqual(calls, ['led_on', 'led_off']);
  runtime.stop();
  level = 'low';
  runtime.tick(4);
  assert.deepEqual(calls, ['led_on', 'led_off'], 'a stopped runtime does nothing');
});

test('an edge rule fires only on its transition', () => {
  /** @type {string[]} */
  const calls = [];
  let level = /** @type {'low'|'high'} */ ('high');
  const runtime = createBehaviorRuntime({
    body: { behaviors: [{ on: { resource: 'button', edge: 'down' }, run: [{ command: 'down' }] }] },
    read: () => level,
    run: async (name) => { calls.push(name); },
  });
  runtime.start();
  level = 'low'; runtime.tick(1);
  assert.deepEqual(calls, ['down']);
  level = 'low'; runtime.tick(2);
  assert.deepEqual(calls, ['down']);
  level = 'high'; runtime.tick(3);
  assert.deepEqual(calls, ['down']);
  level = 'low'; runtime.tick(4);
  assert.deepEqual(calls, ['down', 'down']);
  runtime.stop();
});

test('a periodic rule runs at its interval, not every tick', () => {
  /** @type {string[]} */
  const calls = [];
  let time = 0;
  const runtime = createBehaviorRuntime({
    body: { behaviors: [{ on: { everyMs: 50 }, run: [{ command: 'beat' }] }] },
    read: () => null,
    run: async (name) => { calls.push(name); },
    now: () => time,
  });
  runtime.start();
  runtime.tick(0);
  time = 49; runtime.tick(49);
  assert.deepEqual(calls, []);
  time = 50; runtime.tick(50);
  assert.deepEqual(calls, ['beat']);
  time = 99; runtime.tick(99);
  assert.deepEqual(calls, ['beat']);
  time = 100; runtime.tick(100);
  assert.deepEqual(calls, ['beat', 'beat']);
  runtime.stop();
});

test('a failed command is reported and does not stop the next step', async () => {
  /** @type {string[]} */
  const calls = [];
  /** @type {unknown[]} */
  const errors = [];
  let level = /** @type {'low'|'high'} */ ('high');
  const runtime = createBehaviorRuntime({
    body: {
      behaviors: [
        { on: { resource: 'a', level: 'low' }, run: [{ command: 'bad' }, { command: 'good' }] },
      ],
    },
    read: () => level,
    run: async (name) => {
      if (name === 'bad') throw new Error('no');
      calls.push(name);
    },
    onError: (error) => errors.push(error),
  });
  runtime.start();
  level = 'low';
  runtime.tick(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(errors.length, 1);
  assert.deepEqual(calls, ['good']);
  runtime.stop();
});

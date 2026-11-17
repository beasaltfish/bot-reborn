import test from 'node:test';
import assert from 'node:assert/strict';

import { createBoardRuntime } from '../../sim/firmware/runtime.js';
import { emptyBench } from '../../sim/bench.js';

const bench = emptyBench();
const board = { ...bench.board, settings: { ...bench.board.settings, token: 'a'.repeat(32) } };
const OUTCOME = { esp: 'ok', mic: 'ok', amp: 'ok', screenModel: null, parts: {} };

function harness(over = {}) {
  const lines = /** @type {string[]} */ ([]);
  const links = /** @type {string[]} */ ([]);
  const runtime = createBoardRuntime({
    board, bench, outcome: OUTCOME, profile: {},
    brainUrl: 'ws://brain/body',
    connect: (/** @type {any} */ opts) => { links.push(opts.url); return { close() { links.push('closed'); }, send() {}, sendAudio() {} }; },
    openScreen: () => ({ stop() { links.push('screen-closed'); } }),
    onLine: (/** @type {string} */ l) => lines.push(l),
    onLed: () => {},
    onDevice: () => {},
    ...over,
  });
  return { lines, links, runtime };
}

test('start schedules the boot lines and opens the link', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  h.runtime.start();
  t.mock.timers.tick(1000);
  assert.ok(h.lines.some((l) => l.startsWith('body: protocol')));
  assert.deepEqual(h.links, ['ws://brain/body']);
  h.runtime.stop();
});

test('stop closes the link and ignores a late welcome', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  h.runtime.start();
  t.mock.timers.tick(1000);
  h.runtime.stop();
  assert.ok(h.links.includes('closed'));
  const before = h.lines.length;
  t.mock.timers.tick(10000);
  assert.equal(h.lines.length, before);
});

test('a flash session is a bootloader, not a boot', () => {
  const h = harness();
  assert.equal(h.runtime.mode({ pendingFlash: 'sketch-bme280' }), 'bootloader');
  assert.equal(h.runtime.mode({ blocked: true, pendingFlash: 'sketch-bme280' }), 'blocked');
  assert.equal(h.runtime.mode({}), 'boot');
});

test('welcome starts the microphone and audio frames reach the audio link', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let opts;
  const audio = { attached: 0, down: 0, hushed: 0, stops: 0 };
  const h = harness({
    connect: (/** @type {any} */ o) => { opts = o; return { close() {}, send() {}, sendAudio() {} }; },
    audio: {
      attach() { audio.attached += 1; },
      downlink() { audio.down += 1; },
      hush() { audio.hushed += 1; },
      stop() { audio.stops += 1; },
    },
  });
  h.runtime.start();
  t.mock.timers.tick(1000);
  assert.equal(audio.stops, 1); // start() stops any previous boot first
  opts.onWelcome('pet');
  opts.onWelcome('pet');
  assert.equal(audio.attached, 1);
  opts.onAudio(new ArrayBuffer(4));
  assert.equal(audio.down, 1);
  opts.onLost();
  assert.equal(audio.hushed, 1);
  h.runtime.stop();
  assert.equal(audio.stops, 2);
});

test('busy rejects retry until the runtime budget ends, then are final', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let reject;
  const lines = [];
  const h = harness({
    connect: (/** @type {any} */ opts) => { reject = opts.retryOnReject; return { close() {}, send() {} }; },
    onLine: (/** @type {string} */ l) => lines.push(l),
  });
  h.runtime.start();
  t.mock.timers.tick(1000);
  assert.equal(reject('busy'), true);
  assert.equal(reject('token'), false);
});

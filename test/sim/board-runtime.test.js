import test from 'node:test';
import assert from 'node:assert/strict';

import { createBoardRuntime } from '../../sim/firmware/runtime.js';
import { emptyBench, emptyBoard } from '../../sim/bench.js';
import { createProvisioning } from '../../sim/provision.js';
import { rejectCopy } from '../../sim/ui/reject-copy.js';
import { createBenchIo } from '../../sim/bench-io.js';

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

test('a cmd is answered with a result on the same connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let opts;
  /** @type {any[]} */ const sent = [];
  const h = harness({
    connect: (/** @type {any} */ o) => { opts = o; return { close() {}, send: (/** @type {any} */ m) => sent.push(m), sendAudio() {} }; },
    onIo: async (/** @type {any} */ op) => (op.op === 'pin.read' ? 1 : 0),
  });
  h.runtime.start();
  t.mock.timers.tick(1000);
  opts.onMessage({ type: 'cmd', id: 7, op: 'pin.read', args: { pin: 4 } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.at(-1), { type: 'result', id: 7, ok: true, value: 1 });
  h.runtime.stop();
});

test('a failing or unknown op becomes ok:false, and the runtime keeps running', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let opts;
  /** @type {any[]} */ const sent = [];
  const h = harness({
    connect: (/** @type {any} */ o) => { opts = o; return { close() {}, send: (/** @type {any} */ m) => sent.push(m), sendAudio() {} }; },
    onIo: async () => { throw new Error('unavailable: op "servo" is not on this bench'); },
  });
  h.runtime.start();
  t.mock.timers.tick(1000);
  opts.onMessage({ type: 'cmd', id: 8, op: 'servo', args: {} });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.at(-1), { type: 'result', id: 8, ok: false, error: 'unavailable: op "servo" is not on this bench' });
  // A later cmd still gets its own answer: the failure was the op's, not the board's.
  opts.onMessage({ type: 'cmd', id: 9, op: 'pin.write', args: { pin: 5, level: 0 } });
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.at(-1).id, 9);
  h.runtime.stop();
});

test('a pwm cmd answers ok:false through the bench and leaves the pin untouched', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let opts;
  /** @type {any[]} */ const sent = [];
  const io = createBenchIo({ pins: { 5: 0 } });
  const h = harness({
    connect: (/** @type {any} */ o) => { opts = o; return { close() {}, send: (/** @type {any} */ m) => sent.push(m), sendAudio() {} }; },
    onIo: (/** @type {any} */ op) => io.run(op),
  });
  h.runtime.start();
  t.mock.timers.tick(1000);
  opts.onMessage({ type: 'cmd', id: 11, op: 'pwm', args: { pin: 5, us: 1450 }, safe: 0, timeoutMs: 500 });
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.at(-1).ok, false);
  assert.match(sent.at(-1).error, /unavailable/);
  assert.equal(io.level(5), 0);
  h.runtime.stop();
});

test('a cmd on a runtime with no IO answers unavailable instead of hanging', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let opts;
  /** @type {any[]} */ const sent = [];
  const h = harness({ connect: (/** @type {any} */ o) => { opts = o; return { close() {}, send: (/** @type {any} */ m) => sent.push(m), sendAudio() {} }; } });
  h.runtime.start();
  t.mock.timers.tick(1000);
  opts.onMessage({ type: 'cmd', id: 3, op: 'pin.read', args: { pin: 4 } });
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.at(-1).ok, false);
  assert.match(sent.at(-1).error, /unavailable/);
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
  // A boot clears the speaker queue but never stops the audio link itself:
  // the caller owns it across a reboot.
  assert.equal(audio.stops, 0);
  opts.onWelcome('pet');
  opts.onWelcome('pet');
  assert.equal(audio.attached, 1);
  opts.onAudio(new ArrayBuffer(4));
  assert.equal(audio.down, 1);
  opts.onLost();
  assert.ok(audio.hushed >= 1);
  h.runtime.stop();
  assert.equal(audio.stops, 0);
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

test('a known rejection ends the provisioning wait in either language', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const lang of /** @type {const} */ (['en', 'zh'])) {
    /** @type {any} */ let reject;
    const reasons = /** @type {string[]} */ ([]);
    let status = '';
    const provisioning = createProvisioning({
      commands: ['token x'], panel: { type() {} }, reboot() {}, onDone() {},
    });
    provisioning.start();
    const h = harness({
      connect: (/** @type {any} */ o) => { reject = o.onReject; return { close() {}, send() {}, sendAudio() {} }; },
      rejectText: (/** @type {string} */ reason) => rejectCopy(reason, lang),
      onReject: (/** @type {string} */ reason) => {
        // What sim/main.js does: the event, not the printed text, ends the wait.
        reasons.push(reason);
        provisioning.gaveUp();
        status = rejectCopy(reason, lang);
      },
    });
    h.runtime.start();
    t.mock.timers.tick(1000);
    reject('token');
    h.runtime.stop();
    assert.equal(provisioning.done, true);
    assert.deepEqual(reasons, ['token']);
    assert.equal(status, rejectCopy('token', lang));
    assert.ok(h.lines.at(-1) === status, 'the console prints the same sentence as the status line');
  }
});

test('a busy body does not stop the screen link', (t) => {  t.mock.timers.enable({ apis: ['setTimeout'] });
  /** @type {any} */ let reject;
  const opened = /** @type {string[]} */ ([]);
  const h = harness({
    board: { ...board, settings: { ...board.settings, screen: 'ili9341-ips' } },
    connect: (/** @type {any} */ o) => { reject = o.onReject; return { close() {}, send() {}, sendAudio() {} }; },
    openScreen: (/** @type {any} */ o) => { opened.push(o.url); return { stop() {} }; },
  });
  h.runtime.start();
  t.mock.timers.tick(1000);
  reject('busy');
  assert.deepEqual(opened, ['ws://brain/screen']);
  h.runtime.stop();
});

test('a sketch firmware prints its own line, never the body boot', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lines = /** @type {string[]} */ ([]);
  const h = harness({
    board: { ...board, firmware: 'sketch-button-led' },
    onLine: (/** @type {string} */ l) => lines.push(l),
  });
  h.runtime.start();
  t.mock.timers.tick(2000);
  assert.ok(lines.some((l) => l.startsWith('sketch-button-led:')));
  assert.ok(!lines.some((l) => l.startsWith('body: protocol')));
  assert.ok(!lines.some((l) => l.startsWith('not set up')));
  assert.deepEqual(h.links, []);
  h.runtime.stop();
});

const fakeCtx = () => ({ pin() {}, read: () => 'LOW', log() {}, measure() {}, device() {} });

test('a custom boot creates exactly one machine and stops it', () => {
  const board = { ...emptyBoard(), firmware: 'custom', custom: { name: 'm', draft: '', flashed: 'void loop(){}', updatedAt: 1 } };
  const rt = createBoardRuntime({ board, bench, outcome: OUTCOME, connect: () => ({ close() {}, send() {}, sendAudio() {} }), onLine() {}, onLed() {}, sketch: { ctx: () => fakeCtx() } });
  rt.start();
  const first = rt.machine;
  assert.ok(first);
  rt.reboot();
  assert.notEqual(rt.machine, first);
  rt.stop();
  assert.equal(rt.machine, null);
});

test('a custom board with no custom data boots empty without throwing', () => {
  const empty = { ...emptyBoard(), firmware: 'custom', custom: null };
  const rt = createBoardRuntime({ board: empty, bench, outcome: OUTCOME, connect: () => ({ close() {}, send() {}, sendAudio() {} }), onLine() {}, onLed() {}, sketch: { ctx: () => fakeCtx() } });
  assert.doesNotThrow(() => rt.start());
  assert.equal(rt.machine, null);
  rt.stop();
});

test('a custom board with an empty flashed source boots empty', () => {
  const empty = { ...emptyBoard(), firmware: 'custom', custom: { name: 'm', draft: '', flashed: '', updatedAt: 1 } };
  const rt = createBoardRuntime({ board: empty, bench, outcome: OUTCOME, connect: () => ({ close() {}, send() {}, sendAudio() {} }), onLine() {}, onLed() {}, sketch: { ctx: () => fakeCtx() } });
  assert.doesNotThrow(() => rt.start());
  assert.equal(rt.machine, null);
  rt.stop();
});

test('a body firmware creates no interpreter machine', () => {
  const rt = createBoardRuntime({ board, bench, outcome: OUTCOME, connect: () => ({ close() {}, send() {}, sendAudio() {} }), onLine() {}, onLed() {}, sketch: { ctx: () => fakeCtx() } });
  rt.start();
  assert.equal(rt.machine, null);
  rt.stop();
});

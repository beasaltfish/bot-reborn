import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench } from '../../sim/bench.js';
import { planById, planSteps } from '../../sim/plan.js';
import { applyStep, startBench } from '../../sim/recipes.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { ownershipOf } from '../../sim/firmware/ownership.js';
import * as preview from '../../sim/project-preview.js';
import { createBoardRuntime } from '../../sim/firmware/runtime.js';

const envBench = () => planSteps(/** @type {any} */ (planById('environment-display'))).reduce(applyStep, startBench(emptyBench()));

test('a board device with no driver speaks nothing', () => {
  const bench = { ...envBench(), usb: true };
  const out = evaluateBench(bench, { ownership: ownershipOf(bench), deviceStates: {} }).engineering;
  assert.deepEqual(out.bme280, {});
  assert.deepEqual(out.display, {});
});

test('active devices keep their readings', () => {
  const bench = { ...envBench(), usb: true };
  const ownership = ownershipOf(bench);
  const states = Object.fromEntries(Object.keys(ownership).map((id) => [id, 'active']));
  const out = evaluateBench(bench, { ownership, deviceStates: states }).engineering;
  assert.ok(Object.keys(out.bme280).length > 0);
  assert.ok(Object.keys(out.display).length > 0);
});

test('the old device preview is gone', () => {
  assert.equal('previewStates' in preview, false);
});

test('the runtime reports uninitialized until boot finishes, then init results', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bare = emptyBench();
  const bench = { ...bare, placed: bare.placed.filter((p) => p.part === 'esp32') };
  const board = { ...bench.board, firmware: 'sketch-env-display', settings: { ...bench.board.settings, token: 'a'.repeat(32) } };
  const calls = /** @type {string[][]} */ ([]);
  const runtime = createBoardRuntime({
    board, bench, outcome: { esp: 'ok', parts: {} },
    brainUrl: 'ws://brain/body',
    connect: () => ({ close() {}, send() {}, sendAudio() {} }),
    onLine() {}, onLed() {},
    ownership: { env: 'board', oled: 'circuit', tool: 'board' },
    initDevices: (ids) => { calls.push(ids); return { env: 'active', oled: 'init-failed' }; },
  });
  bench.placed.push({ id: 'env', part: 'bme280-i2c', properties: {}, at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false },
    { id: 'oled', part: 'ssd1306', properties: {}, at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false },
    { id: 'tool', part: 'sg90', properties: {}, at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false });
  runtime.start();
  // The circuit-driven display is not the firmware's, and the servo has no driver.
  assert.deepEqual(runtime.deviceStates(), { env: 'uninitialized' });
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, [['env']]);
  assert.deepEqual(runtime.deviceStates(), { env: 'active' });
  runtime.reboot();
  assert.deepEqual(runtime.deviceStates(), { env: 'uninitialized' });
  runtime.stop();
  assert.deepEqual(runtime.deviceStates(), {});
});

test('an init-failed display shows no readings', () => {
  const bench = { ...envBench(), usb: true };
  const ownership = /** @type {Record<string, 'board'>} */ (Object.fromEntries(Object.keys(ownershipOf(bench)).map((id) => [id, 'board'])));
  const out = evaluateBench(bench, { ownership, deviceStates: { env: 'active', oled: 'init-failed' } }).engineering;
  assert.ok(Object.keys(out.bme280).length > 0);
  assert.deepEqual(out.display, {});
});

test('an unknown owner shows nothing even when a device state says active', () => {
  const bench = { ...envBench(), usb: true };
  const ownership = /** @type {Record<string, 'unknown'>} */ (Object.fromEntries(Object.keys(ownershipOf(bench)).map((id) => [id, 'unknown'])));
  const states = Object.fromEntries(Object.keys(ownership).map((id) => [id, 'active']));
  const out = evaluateBench(bench, { ownership, deviceStates: states }).engineering;
  assert.deepEqual(out.bme280, {});
  assert.deepEqual(out.display, {});
});

test('the init pass sees the device records the gate would otherwise hide', () => {
  const bench = { ...envBench(), usb: true };
  const ownership = /** @type {Record<string, 'board'>} */ (Object.fromEntries(Object.keys(ownershipOf(bench)).map((id) => [id, 'board'])));
  const gated = evaluateBench(bench, { ownership, deviceStates: {} }).engineering;
  assert.deepEqual(gated.bme280, {});
  const init = evaluateBench(bench, { ownership, deviceStates: {}, initializing: true }).engineering;
  assert.equal(init.bme280.env.state, 'ready');
  assert.equal(init.display.oled.state, 'ready');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { bodyBoot } from '../../sim/firmware/body-boot.js';
import { BODY } from '../../sim/firmware/body.js';
import { emptyBench, addPart } from '../../sim/bench.js';
import { screenById } from '../../core/screens.js';

const SETTINGS = { ssid: 'bench', pass: '', token: 'a'.repeat(32), url: '', screen: '', calib: { driveSwapped: false, steerSwapped: false } };
const OUTCOME = { esp: 'ok', mic: 'ok', amp: 'ok', screenModel: null, parts: {} };

const run = (over = {}) => bodyBoot({
  settings: SETTINGS, firmware: BODY, bench: emptyBench(), outcome: OUTCOME, profile: {}, now: 0, ...over,
});

test('missing token stops at not set up and never opens the link', () => {
  const events = run({ settings: { ...SETTINGS, token: '' } });
  assert.ok(events.some((e) => e.line?.startsWith('not set up: type token')));
  assert.ok(!events.some((e) => e.link === 'open'));
});

test('a configured token dials and says hello', () => {
  const events = run();
  assert.ok(events.some((e) => e.line === 'body: protocol 3, brain at auto (found on the network)'));
  assert.ok(events.some((e) => e.link === 'open'));
});

test('no screen selected prints the firmware line and opens no screen link', () => {
  const events = run();
  assert.ok(events.some((e) => e.line?.startsWith('no screen selected')));
  assert.ok(!events.some((e) => e.link === 'screen'));
});

test('a sketch firmware never opens the body or screen link', () => {
  const sketch = { ...BODY, id: 'sketch-x', link: null };
  const events = bodyBoot({ settings: { ...SETTINGS, screen: 'ili9341-ips' }, firmware: sketch, bench: emptyBench(), outcome: { ...OUTCOME, screenModel: 'ili9341-ips' }, profile: {}, now: 0 });
  assert.ok(!events.some((e) => e.link === 'open' || e.link === 'screen'));
});

test('an unknown MISO response prints no identity line', () => {
  const events = run({ settings: { ...SETTINGS, screen: 'ili9341-ips' }, outcome: { ...OUTCOME, screenModel: null } });
  assert.ok(!events.some((e) => /panel identifies|answers like/.test(e.line ?? '')));
});

test('the wand is found only when the IMU evaluated awake', () => {
  let bench = addPart(emptyBench(), 'mpu6050', { x: 20, z: 20 }).bench;
  const imu = bench.placed.find((p) => p.part === 'mpu6050');
  assert.ok(imu);
  const asleep = run({ bench, outcome: { ...OUTCOME, parts: { [imu.id]: { kind: 'imu', awake: false } } } });
  assert.ok(asleep.some((e) => e.line?.includes('no MPU-6050 answered')));
  const awake = run({ bench, outcome: { ...OUTCOME, parts: { [imu.id]: { kind: 'imu', awake: true } } } });
  assert.ok(awake.some((e) => e.line === 'wand: MPU-6050 found'));
});

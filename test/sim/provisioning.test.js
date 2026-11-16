import test from 'node:test';
import assert from 'node:assert/strict';

import { planById } from '../../sim/plan.js';
import { provisionPlan, isRemote, screenMismatch, planScreen } from '../../sim/provision.js';
import { emptyBoard } from '../../sim/bench.js';

const settings = (over = {}) => ({ ...emptyBoard().settings, ...over });

test('a plan that talks to a character needs a token; a device plan does not', () => {
  assert.deepEqual(provisionPlan(planById('audio'), settings()).missing, ['token']);
  assert.deepEqual(provisionPlan(planById('bme280-readings'), settings()).missing, []);
});

test('a configured token but empty screen still provisions the screen', () => {
  const plan = planById('screen');
  assert.ok(plan);
  assert.equal(planScreen(plan), 'ili9341-ips');
  assert.deepEqual(provisionPlan(plan, settings({ token: 'a'.repeat(32) })).missing, ['screen']);
});

test('a screen with another model is a mismatch, not a silent reuse', () => {
  const plan = planById('screen');
  assert.ok(plan);
  assert.equal(screenMismatch(plan, settings({ screen: 'st7789-240x320' })), true);
  assert.equal(screenMismatch(plan, settings({ screen: 'ili9341-ips' })), false);
});

test('an explicit remote brain is recognised', () => {
  assert.equal(isRemote('', 'http://localhost:8787'), false);
  assert.equal(isRemote('ws://localhost:8787/body', 'http://localhost:8787'), false);
  assert.equal(isRemote('ws://other:8787/body', 'http://localhost:8787'), true);
});

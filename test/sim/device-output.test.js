import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench } from '../../sim/bench.js';
import { planById, planSteps } from '../../sim/plan.js';
import { applyStep, startBench } from '../../sim/recipes.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { ownershipOf } from '../../sim/firmware/ownership.js';
import * as preview from '../../sim/project-preview.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench } from '../../sim/bench.js';
import { startBench, applyStep } from '../../sim/recipes.js';
import { planSteps } from '../../sim/plan.js';
import { planById } from '../../sim/plan.js';
import { nextPlanHint } from '../../sim/guidance.js';

test('the next plan hint follows the selected project, not the legacy target', () => {
  const power = planById('power-a-rail');
  assert.ok(power);
  assert.deepEqual(nextPlanHint(emptyBench(), power, 'en')?.points, ['bat:+', 'reg:VIN']);
  const button = planById('button-led');
  assert.ok(button);
  assert.deepEqual(nextPlanHint(emptyBench(), button, 'en')?.points, ['btn:VCC', 'esp:3V3']);
});

test('a plan with a missing part names it before its connection', () => {
  const plan = planById('distance-reader');
  assert.ok(plan);
  const hint = nextPlanHint(emptyBench(), plan, 'en');
  assert.match(hint?.text ?? '', /sonar/);
});

test('a completed plan has no next hint', () => {
  const plan = planById('power-a-rail');
  assert.ok(plan);
  const bench = planSteps(plan).reduce(applyStep, startBench(emptyBench()));
  assert.equal(nextPlanHint(bench, plan, 'en'), null);
});

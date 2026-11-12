import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, setPartProperty } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { applyLedDamage } from '../../sim/electrical/led-bench.js';
import { rankedDiagnoses } from '../../sim/ranked-diagnoses.js';

/** @param {boolean} reversed */
function direct(reversed = false) {
  let bench = emptyBench();
  for (const part of /** @type {const} */ (['led-5mm', 'dc-source'])) bench = addPart(bench, part, { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', reversed ? 'led:K' : 'led:A', 'red');
  return addWire(bench, 'src:-', reversed ? 'led:A' : 'led:K', 'black');
}

test('a reversed LED is reported with points without marking it burnt', () => {
  const bench = direct(true);
  const result = evaluateBench(bench);
  const fault = result.faults.find(item => item.code === 'led-reversed');
  assert.ok(fault);
  assert.deepEqual(fault.points, ['led:A', 'led:K']);
  assert.ok(!result.burns.includes('led'));
  assert.ok(rankedDiagnoses(bench, result, 'zh').some(hint => /极性接反/.test(hint.text)));
});

test('overcurrent is recorded in the shared outcome and a damaged LED remains diagnosable', () => {
  const bench = direct();
  const initial = evaluateBench(bench);
  const fault = initial.faults.find(item => item.code === 'led-overcurrent');
  assert.ok(fault);
  assert.ok(initial.burns.includes('led'));
  const damaged = applyLedDamage(bench).bench;
  const after = evaluateBench(damaged);
  assert.ok(after.faults.some(item => item.code === 'led-burnt'));
  assert.ok(!after.burns.includes('led'), 'already burnt parts do not burn again');
  assert.ok(rankedDiagnoses(damaged, after, 'en').some(hint => /replace/i.test(hint.text)));
});

test('current-limited operation is explained without falsely marking damage', () => {
  const bench = setPartProperty(direct(), 'src', 'currentLimitMa', 10);
  const result = evaluateBench(bench);
  assert.ok(result.faults.some(item => item.code === 'led-current-limited'));
  assert.ok(!result.burns.includes('led'));
});

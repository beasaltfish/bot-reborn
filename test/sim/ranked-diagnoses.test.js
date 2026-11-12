import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { rankedDiagnoses } from '../../sim/ranked-diagnoses.js';

test('destructive and unsafe faults rank before warnings and unsupported firmware', () => {
  const bench = emptyBench();
  const result = evaluateBench(bench);
  const outcome = { ...result, faults: [
    { code: 'firmware-unsupported', points: ['mic:SD'] },
    { code: 'mic-unpowered', points: ['mic:VDD'] },
    { code: 'source-current-limit', severity: 'warning', points: ['esp:5V'] },
    { code: 'device-overvoltage', severity: 'destructive', points: ['mic:VDD'] },
    { code: 'short-rails', points: ['esp:3V3', 'esp:GND'] },
  ] };
  const hints = rankedDiagnoses(bench, outcome, 'zh');
  assert.equal(hints.length, 5);
  assert.deepEqual(hints.map(h => h.points), [['mic:VDD'], ['esp:3V3', 'esp:GND'], ['mic:VDD'], ['esp:5V'], ['mic:SD']]);
  assert.match(hints[0].text, /超过设备额定值/);
  assert.match(hints[1].text, /短接/);
  assert.ok(hints.every(h => h.kind === 'fault'));
});

test('no faults produces no diagnoses even if recipe wires are missing', () => {
  const bench = emptyBench();
  const result = evaluateBench(bench);
  assert.deepEqual(rankedDiagnoses(bench, { ...result, faults: [] }), []);
});

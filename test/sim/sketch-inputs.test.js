import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { partsView, measureSonar } from '../../sim/firmware/parts-view.js';

function buttonBench() {
  let b = emptyBench();
  b = addPart(b, 'button-module', { x: 10, z: 30 }).bench;
  b = addWire(b, 'btn:VCC', 'esp:3V3', 'red');
  b = addWire(b, 'btn:GND', 'esp:GND', 'black');
  b = addWire(b, 'btn:S', 'esp:GPIO4', 'green');
  return { ...b, usb: true };
}

test('the adapter reads a button level from engineering.digital', () => {
  const bench = buttonBench();
  const eng = evaluateBench(bench).engineering;
  const view = partsView(bench, eng, { btn: 'active' });
  assert.equal(view.btn.kind, 'button');
  assert.equal(view.btn.level, 'high');
});

test('a sensor without a driver is not visible to the sketch', () => {
  const bench = buttonBench();
  const eng = evaluateBench(bench).engineering;
  const view = partsView(bench, eng, { btn: 'no-driver' });
  assert.equal(view.btn, undefined);
});

test('measure latches and clears explicitly', () => {
  const on = measureSonar({}, true, 42);
  assert.deepEqual(on.sonar, { measure: true, distanceCm: 42 });
  const off = measureSonar(on, false, 42);
  assert.equal(off.sonar.measure, false);
});

test('the real distance-reader wiring has no distance', () => {
  const bench = buttonBench();
  const eng = evaluateBench(bench).engineering;
  assert.equal(eng.digital.btn.level, 'high');
  // A placed but unwired sonar never reports a distance.
  const sonar = addPart(bench, 'hc-sr04', { x: 20, z: 40 }).bench;
  assert.equal(evaluateBench(sonar).engineering.digital.sonar?.distanceCm ?? null, null);
});

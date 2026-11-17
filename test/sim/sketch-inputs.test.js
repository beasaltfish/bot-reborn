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

import { createSketchContext } from '../../sim/firmware/sketch-context.js';

test('a tick writes pins, measurements and device commands through one context', () => {
  const bench = buttonBench();
  const evaluation = evaluateBench(bench).engineering;
  /** @type {Record<string, Record<string, any>>} */
  const runtime = { servo: {}, motor: {}, strip: {}, display: {}, buttons: {} };
  const pins = /** @type {[string, string][]} */ ([]);
  const measures = /** @type {[string, boolean][]} */ ([]);
  const ctx = createSketchContext({
    bench, evaluation, deviceStates: { btn: 'active' }, runtime,
    onPin: (pin, level) => pins.push([pin, level]),
    onMeasure: (id, on) => measures.push([id, on]),
  });
  assert.equal(ctx.parts.btn.kind, 'button');
  ctx.pin('GPIO5', 'high');
  ctx.pin('GPIO5', { pwm: 0.5 });
  ctx.measure('sonar');
  ctx.measure('sonar', false);
  ctx.device('display', 'oled', { lines: ['T 22.0 C'] });
  ctx.device('servo', 'servo', { angle: 90 });
  ctx.device('strip', 'strip', { pixels: [[0, 160, 40]] });
  assert.deepEqual(pins, [['GPIO5', 'high'], ['GPIO5', 'high-z']]);
  assert.deepEqual(measures, [['sonar', true], ['sonar', false]]);
  assert.deepEqual(runtime.display.oled, { lines: ['T 22.0 C'] });
  assert.deepEqual(runtime.servo.servo, { angle: 90 });
  assert.deepEqual(runtime.strip.strip, { pixels: [[0, 160, 40]] });
});

test('a latched measurement keeps the reading for the next evaluations', () => {
  const bench = buttonBench();
  const sonar = addPart(bench, 'hc-sr04', { x: 20, z: 40 }).bench;
  const wired = { ...addWire(addWire(addWire(addWire(addWire(sonar, 'sonar:VCC', 'esp:3V3', 'red'), 'sonar:GND', 'esp:GND', 'black'), 'sonar:TRIG', 'esp:GPIO6', 'green'), 'sonar:ECHO', 'esp:GPIO7', 'green'), 'sonar:TRIG', 'esp:GPIO6', 'green'), usb: true };
  const stimuli = { sonar: measureSonar({}, true, 42).sonar };
  const first = evaluateBench(wired, { stimuli }).engineering.digital.sonar;
  const second = evaluateBench(wired, { stimuli }).engineering.digital.sonar;
  assert.equal(first.distanceCm, 42);
  assert.equal(second.distanceCm, 42);
  const off = evaluateBench(wired, { stimuli: { sonar: { measure: false, distanceCm: 42 } } }).engineering.digital.sonar;
  assert.equal(off.distanceCm, null);
});

import { deviceInitialized } from '../../sim/firmware/parts-view.js';

test('a protocol device whose init was refused is not visible; a warning is', () => {
  const evaluation = {
    motor: { m: { state: 'off' } },
    strip: { s: { state: 'level-incompatible' } },
    display: { d: { state: 'ready' } },
  };
  assert.equal(deviceInitialized(evaluation, { id: 'm', part: 'dc-motor-small' }), false);
  // 3.3 V data into a 5 V strip is a warning, not a refusal: it still runs.
  assert.equal(deviceInitialized(evaluation, { id: 's', part: 'ws2812-strip' }), true);
  assert.equal(deviceInitialized(evaluation, { id: 'd', part: 'ssd1306' }), true);
  // A part with no protocol init (an LED) has nothing to fail.
  assert.equal(deviceInitialized(evaluation, { id: 'led', part: 'led-5mm' }), true);
});

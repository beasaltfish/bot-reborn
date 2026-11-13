import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, setPartProperty } from '../../sim/bench.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { evaluateDigitalInputs } from '../../sim/devices/digital-inputs.js';
import { evaluateDevices } from '../../sim/devices/evaluate.js';
import { BUTTON_LESSON } from '../../sim/lessons/button.js';
import { HC_SR04_LESSON } from '../../sim/lessons/hc-sr04.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { startBench, applyStep } from '../../sim/recipes.js';

/** @param {import('../../sim/bench.js').Bench} bench @param {any} [stimuli] */
function run(bench, stimuli = {}, profile = PROFILES[0]) {
  return evaluateDigitalInputs(bench, profile, { controllerPowered: true }, stimuli);
}
function buttonBench(vcc = 'esp:3V3') {
  let b = addPart(emptyBench(), 'button-module', { x: 0, z: 0 }).bench;
  b = addWire(b, 'btn:VCC', vcc, 'red');
  b = addWire(b, 'btn:GND', 'esp:GND', 'black');
  return addWire(b, 'btn:S', 'esp:GPIO4', 'yellow');
}
function sonarBench(trig = 'esp:GPIO4', echo = 'esp:GPIO5') {
  let b = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 0 }).bench;
  for (const [a, target] of /** @type {[string,string][]} */ ([['sonar:VCC', 'esp:5V'], ['sonar:GND', 'esp:GND'], ['sonar:TRIG', trig], ['sonar:ECHO', echo]])) b = addWire(b, a, target, 'yellow');
  return b;
}

test('the KY-004 has its documented three pins and a pressed property', () => {
  const b = buttonBench();
  const part = b.placed.find(p => p.part === 'button-module');
  assert.ok(part);
  assert.deepEqual(Object.keys(part.properties), ['pressed']);
});

test('a 3.3 V button module reads high at rest and low while held', () => {
  const b = buttonBench();
  let result = run(b);
  assert.equal(result.parts.btn.state, 'ready');
  assert.equal(/** @type {any} */ (result.parts.btn).level, 'high');
  assert.equal(result.gpio['esp:GPIO4'], 'high');
  result = run(b, { buttons: { btn: true } });
  assert.equal(result.parts.btn.state, 'pressed');
  assert.equal(/** @type {any} */ (result.parts.btn).level, 'low');
  assert.equal(result.gpio['esp:GPIO4'], 'low');
  assert.equal(run(setPartProperty(b, 'btn', 'pressed', true)).parts.btn.state, 'pressed');
});

test('a 5 V module signal is incompatible with 3.3 V GPIO', () => {
  const result = run(buttonBench('esp:5V'));
  assert.equal(result.parts.btn.supplyVoltage, 5);
  assert.equal(result.gpio['esp:GPIO4'], 'unsupported-voltage');
  assert.ok(result.faults.some(fault => fault.code === 'logic-level-incompatible' && fault.instances.includes('btn')));
});

test('an unpowered or reversed button module is not presented as ready', () => {
  let b = addPart(emptyBench(), 'button-module', { x: 0, z: 0 }).bench;
  b = addWire(b, 'btn:S', 'esp:GPIO4', 'yellow');
  let result = run(b);
  assert.equal(result.parts.btn.state, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'device-unpowered'));
  let reversed = addPart(emptyBench(), 'button-module', { x: 0, z: 0 }).bench;
  reversed = addWire(reversed, 'btn:VCC', 'esp:GND', 'black');
  reversed = addWire(reversed, 'btn:GND', 'esp:3V3', 'red');
  result = run(reversed);
  assert.equal(result.parts.btn.state, 'unsupported');
  assert.ok(result.faults.some(fault => fault.code === 'reverse-polarity'));
});

test('a powered 5 V HC-SR04 ECHO directly into 3.3 V logic is incompatible', () => {
  const result = run(sonarBench());
  assert.equal(result.parts.sonar.state, 'incompatible');
  assert.equal(/** @type {any} */ (result.parts.sonar).distanceCm, null);
  assert.ok(result.faults.some(fault => fault.code === 'logic-level-incompatible' && fault.instances.includes('sonar')));
});

test('a compatible HC-SR04 stays ready until triggered and measures a bounded distance', () => {
  const tolerant = { ...PROFILES[0], gpioVoltage: 5 };
  let result = run(sonarBench(), {}, tolerant);
  assert.equal(result.parts.sonar.state, 'ready');
  assert.equal(/** @type {any} */ (result.parts.sonar).distanceCm, null);
  result = run(sonarBench(), { sonar: { measure: true, distanceCm: 100 } }, tolerant);
  assert.equal(result.parts.sonar.state, 'measured');
  assert.equal(/** @type {any} */ (result.parts.sonar).distanceCm, 100);
  assert.equal(result.parts.sonar.echoDurationUs, 5800);
  assert.equal(/** @type {any} */ (run(sonarBench(), { sonar: { measure: true, distanceCm: 1 } }, tolerant).parts.sonar).distanceCm, 2);
  assert.equal(/** @type {any} */ (run(sonarBench(), { sonar: { measure: true, distanceCm: 500 } }, tolerant).parts.sonar).distanceCm, 400);
});

test('swapped TRIG and ECHO are reported instead of a reading', () => {
  const tolerant = { ...PROFILES[0], gpioVoltage: 5 };
  const result = run(sonarBench('esp:GPIO5', 'esp:GPIO4'), {}, tolerant);
  assert.equal(result.parts.sonar.state, 'swapped');
  assert.ok(result.faults.some(fault => fault.code === 'hc-sr04-swapped'));
});

test('an ECHO path through a resistor is not silently treated as compatible', () => {
  let b = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 0 }).bench;
  b = addPart(b, 'resistor', { x: 10, z: 0 }).bench;
  for (const [a, target] of /** @type {[string,string][]} */ ([['sonar:VCC', 'esp:5V'], ['sonar:GND', 'esp:GND'], ['sonar:TRIG', 'esp:GPIO4'], ['sonar:ECHO', 'r:1'], ['r:2', 'esp:GPIO5']])) b = addWire(b, a, target, 'yellow');
  const result = run(b, {}, { ...PROFILES[0], gpioVoltage: 5 });
  assert.equal(result.parts.sonar.state, 'unsupported');
});

test('an unpowered HC-SR04 is off', () => {
  const b = addWire(addPart(emptyBench(), 'hc-sr04', { x: 0, z: 0 }).bench, 'sonar:ECHO', 'esp:GPIO5', 'yellow');
  const result = run(b);
  assert.equal(result.parts.sonar.state, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'device-unpowered'));
});

test('the shared evaluator exposes digital states for a powered bench', () => {
  const b = { ...buttonBench(), usb: true };
  const result = evaluateDevices(b, { stimuli: { buttons: { btn: true } } });
  assert.equal(result.digital.btn.state, 'pressed');
  assert.equal(result.gpio['esp:GPIO4'], 'low');
});

test('the button and sonar lessons and projects validate', () => {
  for (const lesson of [BUTTON_LESSON, HC_SR04_LESSON]) assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
  const button = projectById('button-led');
  assert.ok(button);
  assert.equal(button.links.length, 6);
  const buttonBenchDone = button.steps.reduce(applyStep, startBench(emptyBench()));
  assert.deepEqual(connectionProgress(buttonBenchDone, button).map(link => link.status), Array(6).fill('complete'));
  const sonar = projectById('distance-reader');
  assert.ok(sonar);
  assert.equal(sonar.links.length, 4);
  assert.ok(sonar.steps.some(step => step.kind === 'usb'));
});

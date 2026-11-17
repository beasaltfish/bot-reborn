import test from 'node:test';
import assert from 'node:assert/strict';

import { PROJECTS } from '../../sim/projects.js';
import { FIRMWARES, firmwareFor } from '../../sim/firmware/index.js';
import { planById, planSteps } from '../../sim/plan.js';
import { emptyBench, emptyBoard, addPart, addWire } from '../../sim/bench.js';
import { checkResources } from '../../sim/devices/profiles.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { ownershipOf } from '../../sim/firmware/ownership.js';
import { applyStep, startBench } from '../../sim/recipes.js';

test('every project declares a firmware that exists, or null', () => {
  for (const project of PROJECTS) {
    if (project.firmware === null) continue;
    assert.ok(FIRMWARES[project.firmware], `${project.id}: ${project.firmware}`);
  }
});

test('a firmware project has a flash step after its wiring', () => {
  const steps = planSteps(/** @type {any} */ (planById('button-led')));
  assert.equal(steps.at(-1)?.kind, 'flash');
  assert.equal(/** @type {any} */ (steps.at(-1)).firmware, 'sketch-button-led');
});

test('an independent LED is not firmware-unsupported', () => {
  let b = emptyBench();
  b = addPart(b, 'led-5mm', { x: 10, z: 30 }).bench;
  b = addPart(b, 'resistor', { x: 0, z: 30 }).bench;
  b = addPart(b, 'dc-source', { x: -20, z: 30 }).bench;
  b = addWire(b, 'src:+', 'r:1', 'red');
  b = addWire(b, 'r:2', 'led:A', 'red');
  b = addWire(b, 'led:K', 'src:-', 'black');
  const issues = checkResources(b, PROFILES[0], DEVICES, { ownership: ownershipOf(b), drivers: FIRMWARES.body.drivers });
  assert.ok(!issues.some((i) => i.code === 'firmware-unsupported' && i.instances.includes('led')));
});

test('the body firmware has no BME280 driver and says so', () => {
  let b = emptyBench();
  b = addPart(b, 'bme280-i2c', { x: 10, z: 30 }).bench;
  const issues = checkResources(b, PROFILES[0], DEVICES, { ownership: ownershipOf(b), drivers: FIRMWARES['sketch-bme280'].drivers });
  assert.ok(!issues.some((i) => i.code === 'firmware-unsupported' && i.instances.includes('env')));
  const body = checkResources(b, PROFILES[0], DEVICES, { ownership: ownershipOf(b), drivers: FIRMWARES.body.drivers });
  assert.ok(body.some((i) => i.code === 'firmware-unsupported' && i.instances.includes('env')));
});

import { evaluateBench } from '../../sim/devices/evaluate.js';
import { partsView } from '../../sim/firmware/parts-view.js';
import { SKETCHES } from '../../sim/firmware/sketches.js';

test('button-led: a pressed button drives GPIO5 and the LED lights through the circuit', () => {
  const bench = { ...planSteps(/** @type {any} */ (planById('button-led'))).reduce(applyStep, startBench(emptyBench())), usb: true };
  const pressed = {
    ...bench,
    placed: bench.placed.map((p) => (p.part === 'button-module' ? { ...p, properties: { ...p.properties, pressed: true } } : p)),
  };
  const ownership = ownershipOf(pressed);
  const states = Object.fromEntries(Object.entries(ownership).filter(([, own]) => own === 'board').map(([id]) => [id, 'active']));
  const evaluation = evaluateBench(pressed, { ownership, deviceStates: states }).engineering;
  const gpio = /** @type {Record<string, string>} */ ({});
  const sketch = SKETCHES.find((s) => s.id === 'sketch-button-led');
  assert.ok(sketch);
  /** @type {any} */ (sketch).tick({
    parts: partsView(pressed, evaluation),
    pin: (/** @type {string} */ name, /** @type {string} */ level) => { gpio[name] = level; },
    measure() {}, device() {},
  });
  assert.equal(gpio.GPIO5, 'high');
  const lit = evaluateBench(pressed, { ownership, deviceStates: states, gpioOutputs: /** @type {any} */ (gpio) }).engineering;
  assert.equal(lit.leds.led.state, 'on');
});

import { compile, createMachine } from '../../sim/firmware/lang/index.js';

test('an independent LED is not firmware-unsupported under custom', () => {
  let b = emptyBench();
  b = addPart(b, 'led-5mm', { x: 10, z: 30 }).bench;
  b = addPart(b, 'resistor', { x: 0, z: 30 }).bench;
  b = addPart(b, 'dc-source', { x: -20, z: 30 }).bench;
  b = addWire(b, 'src:+', 'r:1', 'red');
  b = addWire(b, 'r:2', 'led:A', 'red');
  b = addWire(b, 'led:K', 'src:-', 'black');
  const issues = checkResources(b, PROFILES[0], DEVICES, { ownership: ownershipOf(b), drivers: FIRMWARES.custom.drivers });
  assert.ok(!issues.some((i) => i.code === 'firmware-unsupported' && i.instances.includes('led')));
});

test('a button-led custom program reads the real GPIO and lights the real LED', () => {
  const bench = { ...planSteps(/** @type {any} */ (planById('button-led'))).reduce(applyStep, startBench(emptyBench())), usb: true };
  const withPressed = (/** @type {boolean} */ pressed) => ({ ...bench, placed: bench.placed.map((p) => (p.part === 'button-module' ? { ...p, properties: { ...p.properties, pressed } } : p)) });
  const { program } = compile('void setup(){ pinMode(4, INPUT); pinMode(5, OUTPUT); } void loop(){ if (digitalRead(4) == LOW) { digitalWrite(5, HIGH); } else { digitalWrite(5, LOW); } }');
  const run = (/** @type {boolean} */ pressed) => {
    const b = withPressed(pressed);
    const ownership = ownershipOf(b);
    const states = Object.fromEntries(Object.entries(ownership).filter(([, own]) => own === 'board').map(([id]) => [id, 'active']));
    const evaluation = evaluateBench(b, { ownership, deviceStates: states }).engineering;
    const writes = /** @type {Record<string, 'high'|'low'|'high-z'>} */ ({});
    const ctx = {
      /** @param {string} name @param {'high'|'low'|'high-z'} level */
      pin: (name, level) => { writes[name] = level; },
      /** @param {number} pin */
      read: (pin) => evaluation.gpio?.[`esp:GPIO${pin}`] === 'low' ? 'LOW' : 'HIGH',
      log() {}, measure() {}, device() {},
    };
    const m = createMachine({ program: /** @type {any} */ (program) }); m.start();
    m.tick(ctx); // setup
    m.tick(ctx); // loop
    const lit = evaluateBench(b, { ownership, deviceStates: states, gpioOutputs: writes }).engineering;
    return { writes, lit };
  };
  const down = run(true);
  assert.equal(down.writes.GPIO5, 'high');
  assert.equal(down.lit.leds.led.state, 'on');
  const up = run(false);
  assert.equal(up.writes.GPIO5, 'low');
  assert.equal(up.lit.leds.led.state, 'off');
});

test('firmwareFor is used for a blank board', () => {
  assert.equal(firmwareFor({ ...emptyBoard(), firmware: '' }), undefined);
});

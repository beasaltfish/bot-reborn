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

test('every project declares a flashable firmware or a simulation, and it exists', () => {
  for (const project of PROJECTS) {
    if (project.firmware) assert.ok(FIRMWARES[project.firmware], `${project.id}: ${project.firmware}`);
    if (project.simulation) assert.ok(FIRMWARES[project.simulation], `${project.id}: ${project.simulation}`);
    // A project is one or the other; a simulation is not a flash target.
    assert.ok(!(project.firmware && project.simulation), project.id);
  }
});

test('no project is a simulation after the device bodies landed', () => {
  assert.deepEqual(PROJECTS.filter((entry) => entry.simulation).map((entry) => entry.id), []);
  for (const entry of PROJECTS) {
    assert.ok(!planSteps(/** @type {any} */ (planById(entry.id))).some((step) => step.kind === 'flash') || entry.firmware);
  }
});

test('a bench body has no firmware and no flash step', () => {
  const plan = /** @type {any} */ (planById('button-led'));
  const steps = planSteps(plan);
  assert.equal(plan.firmware, null);
  assert.ok(!steps.some((step) => step.kind === 'flash'));
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
  const issues = checkResources(b, PROFILES[0], DEVICES, { ownership: ownershipOf(b), drivers: FIRMWARES['sketch-env-display'].drivers });
  assert.ok(!issues.some((i) => i.code === 'firmware-unsupported' && i.instances.includes('env')));
  const body = checkResources(b, PROFILES[0], DEVICES, { ownership: ownershipOf(b), drivers: FIRMWARES.body.drivers });
  assert.ok(body.some((i) => i.code === 'firmware-unsupported' && i.instances.includes('env')));
});

import { evaluateBench } from '../../sim/devices/evaluate.js';
import { createBenchIo } from '../../sim/bench-io.js';
import { createBehaviorRuntime } from '../../sim/behavior-runtime.js';
import { loadBenchBodies } from '../../sim/bench-bodies.js';
import { expandCommand } from '../../core/io-program.js';
import { gpioInputLevel } from '../../sim/firmware/sketch-context.js';

test('button-led: its body behavior drives GPIO5 and the LED lights', async () => {
  const body = loadBenchBodies().bodies['button-led'];
  assert.ok(body);
  const bench = { ...planSteps(/** @type {any} */ (planById('button-led'))).reduce(applyStep, startBench(emptyBench())), usb: true };
  const withPressed = (/** @type {boolean} */ pressed) => ({
    ...bench,
    placed: bench.placed.map((p) => (p.part === 'button-module' ? { ...p, properties: { ...p.properties, pressed } } : p)),
  });
  const ownership = ownershipOf(bench);
  const states = Object.fromEntries(Object.entries(ownership).filter(([, own]) => own === 'board').map(([id]) => [id, 'active']));
  /** @type {Record<string, 'high'|'low'>} */
  const gpio = {};
  let pressed = false;
  const io = createBenchIo({
    writePin: (pin, level) => { gpio[`GPIO${pin}`] = level ? 'high' : 'low'; },
    readPin: () => 'LOW',
  });
  const read = (/** @type {string} */ name) => {
    const resource = (body.resources ?? []).find((entry) => entry.name === name);
    if (!resource || !Number.isInteger(resource.gpio)) return null;
    const evaluation = evaluateBench(withPressed(pressed), { ownership, deviceStates: states, gpioOutputs: gpio }).engineering;
    const level = gpioInputLevel(evaluation, /** @type {number} */ (resource.gpio));
    return level === 'HIGH' ? 'high' : level === 'LOW' ? 'low' : null;
  };
  const runtime = createBehaviorRuntime({
    body,
    read,
    run: async (/** @type {string} */ name) => {
      const command = (body.commands ?? []).find((entry) => entry.name === name);
      assert.ok(command);
      const { ops, drop } = expandCommand(command, {}, body.resources ?? []);
      assert.equal(drop, undefined);
      for (const op of ops) await io.run(op);
    },
  });
  runtime.start();
  pressed = true;
  runtime.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gpio.GPIO5, 'high');
  const lit = evaluateBench(withPressed(true), { ownership, deviceStates: states, gpioOutputs: gpio }).engineering;
  assert.equal(lit.leds.led.state, 'on');

  pressed = false;
  runtime.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gpio.GPIO5, 'low');
  const dark = evaluateBench(withPressed(false), { ownership, deviceStates: states, gpioOutputs: gpio }).engineering;
  assert.equal(dark.leds.led.state, 'off');
  runtime.stop();
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

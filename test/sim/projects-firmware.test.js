import test from 'node:test';
import assert from 'node:assert/strict';

import { PROJECTS } from '../../sim/projects.js';
import { FIRMWARES } from '../../sim/firmware/index.js';
import { planById, planSteps } from '../../sim/plan.js';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { checkResources } from '../../sim/devices/profiles.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { ownershipOf } from '../../sim/firmware/ownership.js';

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

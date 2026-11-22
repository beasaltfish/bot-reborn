import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LED_MODULE } from '../../sim/modules/led-module.js';
import { projectFromModule } from '../../sim/project-module.js';
import { projectById } from '../../sim/projects.js';
import { planById, planSteps } from '../../sim/plan.js';

test('the sim literal and the repo module are the same data', () => {
  const json = JSON.parse(readFileSync(new URL('../../modules/led-module/module.json', import.meta.url), 'utf8'));
  assert.deepEqual(LED_MODULE, json);
});

test('the module project builds on the audio bench and wires the module', () => {
  const project = /** @type {import('../../sim/projects.js').Project} */ (projectById('module-led-module'));
  assert.equal(project.firmware, 'body');
  assert.equal(project.connection, 'body');
  assert.deepEqual(project.links.map((l) => l.a).slice(-3), ['esp:GPIO5', 'r:2', 'led:K']);
  const steps = planSteps(/** @type {any} */ (planById('module-led-module')));
  assert.ok(steps.some((s) => s.kind === 'flash' && s.firmware === 'body'));
  assert.ok(steps.some((s) => s.kind === 'wire' && s.named?.includes('esp:GPIO5')));
});

test('building the module project leaves the base bench alone', () => {
  const base = /** @type {import('../../sim/projects.js').Project} */ (projectById('audio'));
  const before = structuredClone(base);
  const project = projectFromModule(LED_MODULE, base);
  assert.deepEqual(base, before);
  assert.notEqual(project, base);
});

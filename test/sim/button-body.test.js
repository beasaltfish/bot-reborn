// The button demo is generated from its body manifest: parts, links and the
// local behavior in one place. There is no sketch and no firmware field.

import test from 'node:test';
import assert from 'node:assert/strict';
import { projectById } from '../../sim/projects.js';
import { projectFromBody } from '../../sim/project-module.js';
import { bodyFrom } from '../../core/plugin-manifest.js';
import manifest from '../../sim/bodies/button-led/body.json' with { type: 'json' };
import { emptyBench } from '../../sim/bench.js';
import { planById, planSteps, planUsesBoard } from '../../sim/plan.js';
import { applyStep, startBench } from '../../sim/recipes.js';

test('button-led is generated from its body manifest', () => {
  const project = projectById('button-led');
  assert.ok(project);
  assert.equal(project.id, 'button-led');
  assert.equal(project.connection, 'bench');
  assert.equal(project.firmware, null);
  assert.equal(project.body, 'button-led');
  assert.equal(project.adoptable, false);
  assert.equal(project.ending, 'Press the button');
  assert.deepEqual(project.links.map((link) => [link.a, link.b]), [
    ['btn:VCC', 'esp:3V3'],
    ['btn:GND', 'esp:GND'],
    ['btn:S', 'esp:GPIO4'],
    ['esp:GPIO5', 'r:1'],
    ['r:2', 'led:A'],
    ['led:K', 'esp:GND'],
  ]);
});

test('the generated project has no sketch and keeps the board', () => {
  const plan = planById('button-led');
  assert.ok(plan);
  assert.equal(plan.firmware, null);
  assert.equal(planUsesBoard(plan), true);
  const bench = planSteps(plan).reduce(applyStep, startBench(emptyBench()));
  assert.deepEqual(bench.placed.map((part) => part.part).sort(), ['button-module', 'esp32', 'led-5mm', 'resistor']);
});

test('the generated project is listed where the handwritten one was', () => {
  const project = projectById('button-led');
  assert.ok(project);
  assert.ok(project.steps.some((step) => step.kind === 'part' && step.part === 'button-module'));
  assert.ok(project.steps.some((step) => step.kind === 'wire'));
  // Power is the runner's step, not the project's: a lab handoff must not
  // silently plug the bench.
  assert.ok(!project.steps.some((step) => step.kind === 'usb'));
});

test('moving the LED resource moves the project link too', () => {
  const moved = structuredClone(manifest);
  moved.resources = moved.resources.map((resource) => resource.name === 'led' ? { ...resource, gpio: 6 } : resource);
  moved.wiring.links = moved.wiring.links.map((link) => ({
    ...link,
    a: link.a === 'esp:GPIO5' ? 'esp:GPIO6' : link.a,
    b: link.b === 'esp:GPIO5' ? 'esp:GPIO6' : link.b,
  }));
  const project = projectFromBody(bodyFrom(moved));
  assert.equal(project.body, 'button-led');
  assert.equal(project.firmware, null);
  assert.ok(project.links.some((link) => link.a === 'esp:GPIO6' || link.b === 'esp:GPIO6'));
  assert.ok(!project.links.some((link) => link.a === 'esp:GPIO5' || link.b === 'esp:GPIO5'));
});

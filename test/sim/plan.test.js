import test from 'node:test';
import assert from 'node:assert/strict';
import { planFromProject, planFromRecipe, planById, planSteps, planId, planOptionsFor } from '../../sim/plan.js';
import { addPart } from '../../sim/bench.js';
import { projectById } from '../../sim/projects.js';
import { emptyBench } from '../../sim/bench.js';
import { startBench, applyStep } from '../../sim/recipes.js';
import { targetFor } from '../../sim/target.js';

test('a project becomes a plan with implicit ESP32 and its own links', () => {
  const project = projectById('power-a-rail');
  assert.ok(project);
  const plan = planFromProject(project);
  assert.equal(plan.id, 'power-a-rail');
  assert.equal(plan.goalKey, 'goal.power-a-rail');
  assert.equal(plan.lessonId, 'power-basics-v1');
  assert.ok(!plan.parts.some(part => part.part === 'esp32'));
  assert.deepEqual(plan.links.map(link => [link.a, link.b]), [
    ['bat:+', 'reg:VIN'], ['bat:-', 'reg:GND'], ['reg:VOUT', 'r:1'], ['r:2', 'led:A'], ['led:K', 'reg:GND'],
  ]);
});

test('a recipe becomes a plan with the same observable links and its steps', () => {
  const plan = planFromRecipe('audio');
  assert.ok(plan);
  const bench = planSteps(plan).reduce(applyStep, startBench(emptyBench()));
  assert.deepEqual(plan.links, targetFor(bench));
  assert.ok((plan.legacy?.steps?.length ?? 0) > 0);
  assert.ok(plan.parts.some(part => part.part === 'inmp441'));
  assert.ok(!plan.parts.some(part => part.part === 'esp32'));
});

test('planById prefers authored projects and keeps screen variants', () => {
  assert.equal(planById('led-basics')?.id, 'led-basics');
  const screen = planById('screen', { screenId: 'st7735-160', wand: true });
  assert.equal(screen?.legacy?.screenId, 'st7735-160');
  assert.equal(screen?.legacy?.wand, true);
  assert.ok(screen?.links.some(link => link.a.startsWith('scr:')));
  assert.ok(screen?.links.some(link => link.a === 'scr:SDA' || link.b === 'scr:SDA'));
});

test('plan steps for a new project place parts and wire links but stay unplugged', () => {
  const plan = planById('button-led');
  assert.ok(plan);
  const steps = planSteps(plan);
  assert.ok(steps.some(step => step.kind === 'part' && step.part === 'button-module'));
  assert.equal(steps.filter(step => step.kind === 'wire').length, plan.links.length);
  assert.equal(steps.at(-1)?.kind, 'wire');
  assert.ok(!steps.some(step => step.kind === 'usb'));
});

test('plan identity keeps recipe variants distinct', () => {
  const a = planById('screen', { screenId: 'st7735-160', wand: false });
  const b = planById('screen', { screenId: 'st7735-160', wand: true });
  const c = planById('screen', { screenId: 'ili9341-ips', wand: false });
  if (!a || !b || !c) throw new Error('missing plan');
  assert.notEqual(planId(a), planId(b));
  assert.notEqual(planId(a), planId(c));
  const power = planById('power-a-rail');
  assert.ok(power);
  assert.equal(planId(power), 'power-a-rail');
});

test('the placed screen model overrides the chooser default', () => {
  const bench = addPart(emptyBench(), 'screen-st7735-160', { x: 0, z: 0 }).bench;
  const options = planOptionsFor(bench, { screenId: 'ili9341-ips' });
  assert.equal(options.screenId, 'st7735-160');
  const plan = planById('screen', options);
  assert.ok(plan);
  assert.ok(plan.links.some(link => link.a === 'scr:SDA' || link.b === 'scr:SDA'));
});

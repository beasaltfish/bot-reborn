// A demo that never names the ESP32 is built without one. The controller is
// not a decoration on every bench: an LED loop and a battery/regulator lesson
// are circuits, and a board nobody wired into them reads as part of the build.

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench } from '../../sim/bench.js';
import { planById, planSteps, planUsesBoard } from '../../sim/plan.js';
import { applyStep, startBench } from '../../sim/recipes.js';

/** @param {string} id */
const build = (id) => {
  const plan = planById(id);
  assert.ok(plan);
  return {
    plan,
    bench: planSteps(plan).reduce(applyStep, startBench(emptyBench(), { board: planUsesBoard(plan) })),
  };
};

test('a lesson that names no ESP32 is built without one', () => {
  const { plan, bench } = build('led-basics');
  assert.equal(planUsesBoard(plan), false);
  assert.deepEqual(bench.placed.map((part) => part.part).sort(), ['dc-source', 'led-5mm', 'resistor']);
  // The breadboards stay: the resistor and the LED sit in them.
  assert.ok(bench.boards.length > 0);
});

test('the power rail needs no controller either', () => {
  const { plan, bench } = build('power-a-rail');
  assert.equal(planUsesBoard(plan), false);
  assert.equal(bench.placed.some((part) => part.part === 'esp32'), false);
});

test('a sketch lesson keeps the board it programs', () => {
  const { plan, bench } = build('bme280-readings');
  assert.equal(planUsesBoard(plan), true);
  assert.ok(bench.placed.some((part) => part.part === 'esp32'));
});

test('a body demo keeps the board it runs on', () => {
  for (const id of ['audio', 'screen', 'toy', 'tarot']) {
    const plan = planById(id);
    assert.equal(planUsesBoard(plan), true, id);
  }
});

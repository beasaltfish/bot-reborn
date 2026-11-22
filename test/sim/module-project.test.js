import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LED_MODULE } from '../../sim/modules/led-module.js';
import { projectFromModule } from '../../sim/project-module.js';
import { projectById } from '../../sim/projects.js';
import { planById, planSteps } from '../../sim/plan.js';
import { emptyBench, pinPoints } from '../../sim/bench.js';
import { PARTS, holeStrip } from '../../sim/parts.js';
import { startBench, applyStep } from '../../sim/recipes.js';
import { nets } from '../../sim/netlist.js';

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

test('the module project is a circuit, not two parts on one strip', () => {
  const steps = planSteps(/** @type {any} */ (planById('module-led-module')));
  const bench = steps.reduce(applyStep, startBench(emptyBench()));

  // A wire for a seated pin ends in a free hole; only loose parts and
  // wire-only pins (the speaker's and the amp's screw terminals) keep their
  // own name.
  for (const step of steps) {
    if (step.kind !== 'wire') continue;
    for (const end of [step.a, step.b]) {
      const part = bench.placed.find((p) => end.startsWith(`${p.id}:`));
      if (!part?.seated) continue;
      const pin = PARTS[part.part].pins.find((p) => p.name === end.slice(part.id.length + 1));
      assert.ok(pin?.wireOnly, `${step.named?.join(' ↔ ')}: ${end} still names a seated pin`);
    }
  }

  const netsOf = nets(bench);
  assert.ok(!netsOf.same('led:A', 'led:K'), 'the LED is not shorted');
  assert.ok(!netsOf.same('r:2', 'esp:GND'), 'the resistor is not on ground');
  assert.ok(netsOf.same('r:2', 'led:A'), 'the resistor feeds the LED anode');
  assert.ok(netsOf.same('r:1', 'esp:GPIO5'), 'the resistor input is on the LED GPIO');

  // Not sharing a net is not enough: a module part on the mic's or amp's strip
  // would make a connection the drawing never shows.
  /** @param {string} id */
  const strips = (id) => {
    const placed = bench.placed.find((part) => part.id === id);
    assert.ok(placed, `${id} is placed`);
    return pinPoints(bench, placed).flatMap(({ hole }) => {
      if (!hole) return [];
      const at = hole.indexOf(':');
      return [`${hole.slice(0, at + 1)}${holeStrip(hole.slice(at + 1))}`];
    });
  };
  const moduleStrips = new Set([...strips('r'), ...strips('led')]);
  for (const id of ['mic', 'amp']) {
    for (const strip of strips(id)) {
      assert.ok(!moduleStrips.has(strip), `${id} shares strip ${strip} with a module part`);
    }
  }

  // The audio base keeps its recipe seats, so the mic straddles the trench with
  // every pin in a hole and no module part shares its strips.
  const mic = bench.placed.find((p) => p.id === 'mic');
  assert.ok(mic?.seated);
  for (const { pin, hole } of pinPoints(bench, mic)) assert.ok(hole, `${pin} is not in a hole`);
  for (const id of ['r', 'led']) {
    const placed = bench.placed.find((p) => p.id === id);
    assert.ok(placed?.seated, `${id} is seated`);
    assert.ok(pinPoints(bench, placed).every(({ hole }) => hole), `${id} is in holes`);
  }
});

test('building the module project leaves the base bench alone', () => {
  const base = /** @type {import('../../sim/projects.js').Project} */ (projectById('audio'));
  const before = structuredClone(base);
  const project = projectFromModule(LED_MODULE, base);
  assert.deepEqual(base, before);
  assert.notEqual(project, base);
});

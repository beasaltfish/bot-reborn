// Bench bodies are manifests the workbench loads itself: wiring, resources,
// commands and local behaviors in one file. These tests pin the single-source
// promise: a pin move is one edit, and a link to an undeclared pin is refused.

import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../../sim/bodies/button-led/body.json' with { type: 'json' };
import { bodyFrom, manifestProblem } from '../../core/plugin-manifest.js';
import { loadBenchBodies } from '../../sim/bench-bodies.js';

test('button-led loads from its manifest', () => {
  const { bodies, problems } = loadBenchBodies();
  assert.deepEqual(problems, []);
  const body = bodies['button-led'];
  assert.ok(body);
  assert.equal(body.adoptable, false);
  assert.deepEqual(body.ways.map((way) => way.source), ['none']);
  assert.equal(body.firmware, null);
  assert.deepEqual((body.behaviors ?? []).map((behavior) => behavior.on.level), ['low', 'high']);
  assert.deepEqual((body.resources ?? []).map((resource) => [resource.name, resource.gpio]), [['button', 4], ['led', 5]]);
});

test('moving the LED to another GPIO is one resource and one link', () => {
  const moved = structuredClone(manifest);
  moved.resources = moved.resources.map((resource) => resource.name === 'led' ? { ...resource, gpio: 6 } : resource);
  moved.wiring.links = moved.wiring.links.map((link) => ({
    ...link,
    a: link.a === 'esp:GPIO5' ? 'esp:GPIO6' : link.a,
    b: link.b === 'esp:GPIO5' ? 'esp:GPIO6' : link.b,
  }));
  assert.equal(manifestProblem(moved), null);
  const body = bodyFrom(moved);
  assert.equal((body.resources ?? []).find((resource) => resource.name === 'led')?.gpio, 6);
  // The command and the behavior still name the resource, never the number.
  assert.equal((body.behaviors ?? [])[0].run[0].command, 'led_on');
});

test('a link to a pin the resources do not declare is refused', () => {
  const broken = structuredClone(manifest);
  broken.wiring.links[2] = { ...broken.wiring.links[2], b: 'esp:GPIO9' };
  assert.match(manifestProblem(broken) ?? '', /GPIO9/);
  const { bodies, problems } = loadBenchBodies([broken]);
  assert.deepEqual(bodies, {});
  assert.equal(problems.length, 1);
});

test('a behavior naming a missing command is refused before load', () => {
  const broken = structuredClone(manifest);
  broken.behaviors[0].run[0].command = 'nope';
  assert.match(manifestProblem(broken) ?? '', /nope/);
});

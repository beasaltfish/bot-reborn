import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonByPart } from '../../sim/lessons/index.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { addWire, emptyBench, serialize, load, removeWire } from '../../sim/bench.js';
import { applyStep, startBench } from '../../sim/recipes.js';
import { evaluateLedBench } from '../../sim/electrical/led-bench.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { simText } from '../../sim/ui/strings.js';

test('LED lesson declares five bilingual stages, pin focus, controls and fault challenges', () => {
  const lesson = lessonByPart('led-5mm');
  assert.ok(lesson);
  assert.equal(lesson.id, 'led-5mm-basics-v1');
  assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
  assert.deepEqual(lesson.stages.map(stage => stage.kind), ['recognize', 'pins', 'wire', 'try', 'fault']);
  assert.deepEqual(lesson.stages[1].focusPoints, ['A', 'K']);
  assert.deepEqual(lesson.stages[3].controls, ['voltage', 'resistance']);
  assert.deepEqual(lesson.stages[4].completion.events.map(event => event.value), ['led-reversed', 'led-overcurrent']);
  for (const stage of lesson.stages) assert.notEqual(simText('en', stage.bodyKey), simText('zh', stage.bodyKey));
});

test('the LED project builds a valid standalone loop and round-trips through bench storage', () => {
  const project = projectById('led-basics');
  assert.ok(project);
  const bench = project.steps.reduce(applyStep, startBench(emptyBench()));
  assert.deepEqual(bench.placed.map(part => part.part).sort(), ['dc-source', 'esp32', 'led-5mm', 'resistor']);
  assert.equal(bench.usb, false);
  assert.equal(bench.wires.length, 3);
  assert.equal(evaluateLedBench(bench, 'led').state, 'on');
  assert.ok(connectionProgress(bench, project).every(link => link.status === 'complete'));
  const direct = bench.wires.filter(wire => wire.a.startsWith('r:') || wire.b.startsWith('r:')).reduce((current, wire) => removeWire(current, wire.id), bench);
  const noResistor = addWire(direct, 'src:+', 'led:A', 'red');
  assert.equal(evaluateLedBench(noResistor, 'led').state, 'overcurrent');
  assert.ok(connectionProgress(noResistor, project).some(link => link.faultCodes.includes('led-overcurrent')));
  const restored = load(serialize(bench));
  assert.ok(restored);
  assert.equal(evaluateLedBench(restored, 'led').state, 'on');
});

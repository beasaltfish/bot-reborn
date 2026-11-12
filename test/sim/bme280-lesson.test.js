import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonByPart } from '../../sim/lessons/index.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { applyStep, startBench } from '../../sim/recipes.js';
import { emptyBench, serialize, load } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { createBme280LabExample } from '../../sim/lessons/bme280-example.js';
import { defaultStimuli } from '../../sim/stimuli.js';
import { simText } from '../../sim/ui/strings.js';

test('BME280 lesson contains bilingual stages, wiring, environment and two fault challenges', () => {
  const lesson = lessonByPart('bme280-i2c');
  assert.ok(lesson);
  assert.equal(lesson.id, 'bme280-i2c-basics-v1');
  assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
  assert.deepEqual(lesson.stages.map(stage => stage.kind), ['recognize', 'pins', 'wire', 'try', 'fault']);
  assert.deepEqual(lesson.stages[1].focusPoints, ['VIN', 'GND', 'SDI', 'SCK', 'SDO']);
  assert.ok(lesson.stages[1].controls.includes('address'));
  assert.deepEqual(lesson.stages[3].controls, ['temperatureC', 'humidityPct', 'pressureHpa']);
  assert.deepEqual(lesson.stages[4].completion.events.map(event => event.value), ['i2c-sda-scl-swapped', 'i2c-address-conflict']);
  for (const stage of lesson.stages) assert.notEqual(simText('en', stage.bodyKey), simText('zh', stage.bodyKey));
});

test('lab example and serialized project use the same minimal circuit and simulated result', () => {
  const project = projectById('bme280-readings');
  assert.ok(project);
  const bench = project.steps.reduce(applyStep, startBench(emptyBench()));
  assert.equal(bench.usb, false, 'handoff never silently plugs USB');
  assert.deepEqual(project.links.map(link => [link.a, link.b]), [['env:VIN', 'esp:3V3'], ['env:GND', 'esp:GND'], ['env:SDI', 'esp:GPIO1'], ['env:SCK', 'esp:GPIO2']]);
  const loaded = load(serialize(bench));
  const workbench = evaluateBench({ ...loaded, usb: true }, { stimuli: defaultStimuli() }).engineering.bme280.env;
  const laboratory = createBme280LabExample().evaluate(defaultStimuli());
  assert.deepEqual(laboratory, workbench);
  assert.equal(workbench.state, 'ready');
});

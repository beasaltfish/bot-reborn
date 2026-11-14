import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, serialize, load } from '../../sim/bench.js';
import { PARTS } from '../../sim/parts.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { catalogueEntry } from '../../sim/ui/catalogue-model.js';
import { lessonByPart } from '../../sim/lessons/index.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS } from '../../sim/projects.js';

/** @type {import('../../sim/parts.js').PartDef['id'][]} */
const FIRST_PACK = [
  'led-5mm', 'resistor', 'push-button', 'button-module', 'hc-sr04', 'bme280-i2c',
  'ssd1306', 'sg90', 'tb6612fng', 'dc-motor-small', 'ws2812-strip',
  'usb-5v-source', 'battery-4xaa', 'bench-supply', 'breadboard-regulator',
];
const POWER_FAMILY = new Set(['usb-5v-source', 'battery-4xaa', 'bench-supply', 'breadboard-regulator']);
const LESSON_PARTS = Object.fromEntries([
  ...FIRST_PACK.filter(id => !POWER_FAMILY.has(id)).map(id => [id, id]),
  ...FIRST_PACK.filter(id => POWER_FAMILY.has(id)).map(id => [id, 'battery-4xaa']),
  // The passive resistor and two-terminal button are taught inside the LED and
  // button-module lessons rather than duplicated as standalone lessons.
  ['resistor', 'led-5mm'],
  ['push-button', 'button-module'],
]);

const projectChoices = new Set(PROJECTS.flatMap(project => [
  ...project.steps.filter(step => step.kind === 'part').map(step => step.part),
  ...project.links.flatMap(link => link.a.split(':')[0]),
]));

test('every first-pack device has a part, catalogue row and firmware contract', () => {
  for (const id of FIRST_PACK) {
    assert.ok(PARTS[id], `${id}: part`);
    assert.ok(DEVICES[id], `${id}: device`);
    assert.deepEqual(Object.keys(DEVICES[id].firmware).sort(), ['actions', 'init', 'libraries', 'resources', 'telemetry'], `${id}: firmware`);
    for (const lang of ['en', 'zh']) {
      const entry = catalogueEntry(id, lang);
      assert.ok(entry, `${id}: ${lang} catalogue`);
      assert.notEqual(entry.name, `name.${id}`, `${id}: ${lang} name`);
      assert.notEqual(entry.summary, `summary.${id}`, `${id}: ${lang} summary`);
    }
  }
});

test('every first-pack device can be added and survives a bench round trip', () => {
  for (const id of FIRST_PACK) {
    const added = addPart(emptyBench(), id, { x: 0, z: 0 });
    const loaded = load(serialize(added.bench));
    const part = loaded.placed.find(item => item.id === added.id);
    assert.ok(part, `${id}: added part`);
    assert.deepEqual(part.properties, addPart(emptyBench(), id, { x: 0, z: 0 }).bench.placed.at(-1)?.properties, `${id}: properties`);
  }
});

test('every first-pack family has a five-stage bilingual lesson', () => {
  for (const id of FIRST_PACK) {
    const lesson = lessonByPart(LESSON_PARTS[id]);
    assert.ok(lesson, `${id}: lesson`);
    assert.equal(lesson.stages.length, 5, `${id}: five stages`);
    assert.deepEqual(lesson.stages.map(stage => stage.kind), ['recognize', 'pins', 'wire', 'try', 'fault'], `${id}: stage kinds`);
    assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), [], `${id}: lesson validation`);
  }
});

test('every first-pack device is used by a project, except supply alternatives', () => {
  for (const id of FIRST_PACK) {
    if (id === 'usb-5v-source' || id === 'bench-supply' || id === 'push-button') continue;
    const used = id === 'battery-4xaa' || id === 'breadboard-regulator' ? projectChoices.has(id) : projectChoices.has(id);
    assert.ok(used, `${id}: project use`);
  }
  assert.ok(PROJECTS.some(project => project.id === 'power-a-rail') && PROJECTS.some(project => project.id === 'status-light-strip'));
});

test('the new device pack is reported as not yet implemented by real firmware', () => {
  for (const id of FIRST_PACK) {
    if (PROFILES[0].supportedParts.includes(id)) continue;
    assert.ok(!PROFILES[0].supportedParts.includes(id), `${id}: firmware support must be explicit`);
  }
});

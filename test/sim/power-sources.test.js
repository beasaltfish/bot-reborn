import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { emptyBench, addPart, addWire, setPartProperty, propertiesFor, serialize, load } from '../../sim/bench.js';
import { PARTS } from '../../sim/parts.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { catalogueEntry } from '../../sim/ui/catalogue-model.js';
import { evaluateElectrical } from '../../sim/electrical/evaluate.js';
import { batterySource, BATTERY_CHEMISTRIES } from '../../sim/electrical/power-sources.js';
import { POWER_LESSON } from '../../sim/lessons/power.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { startBench, applyStep } from '../../sim/recipes.js';
import { buildPart, dispose } from '../../sim/scene/meshes.js';

const loadModel = { kind: 'supply', positive: 'VDD', ground: 'GND', currentsMa: { idle: 100 }, minVoltage: 3 };
const devices = { ...DEVICES, inmp441: { capabilities: [loadModel] } };
/** @param {import('../../sim/bench.js').Bench} b @param {import('../../sim/electrical/supply.js').OperatingMode} [mode] */
function run(b, mode = 'idle') { return evaluateElectrical(b, { profile: {}, mode, devices }); }
/** @param {import('../../sim/electrical/supply.js').ElectricalOutcome} o @param {string} id */
function rail(o, id) { return Object.values(o.rails).find(r => r.sourceInstances.includes(id)); }
/** Place a power part and wire it to the microphone load. @param {import('../../sim/parts.js').PartDef['id']} part */
function powered(part) {
  const added = addPart(emptyBench(), part, { x: -20, z: 30 });
  let b = added.bench;
  const positive = PARTS[part].pins[0].name;
  const negative = PARTS[part].pins[1].name;
  b = addWire(b, `${added.id}:${positive}`, 'mic:VDD', 'red');
  b = addWire(b, `${added.id}:${negative}`, 'mic:GND', 'black');
  return { b, id: added.id };
}

test('the four power parts have documented physical pins and seating', () => {
  assert.deepEqual(PARTS['usb-5v-source'].pins.map(p => p.name), ['5V', 'GND']);
  assert.deepEqual(PARTS['battery-4xaa'].pins.map(p => p.name), ['+', '-']);
  assert.deepEqual(PARTS['bench-supply'].pins.map(p => p.name), ['+', '-']);
  assert.deepEqual(PARTS['breadboard-regulator'].pins.map(p => p.name), ['VIN', 'GND', 'VOUT']);
  for (const id of ['usb-5v-source', 'battery-4xaa', 'bench-supply']) {
    assert.equal(PARTS[id].onBoard, false);
    assert.ok(PARTS[id].pins.every(p => p.wireOnly));
  }
  assert.equal(PARTS['breadboard-regulator'].onBoard, true);
  assert.equal(PARTS['breadboard-regulator'].size.w, 53);
  assert.equal(PARTS['breadboard-regulator'].size.d, 33);
});

test('battery properties select a documented chemistry and charge', () => {
  const defaults = propertiesFor('battery-4xaa');
  assert.equal(defaults.chemistry, 'alkaline');
  assert.equal(defaults.charge, 100);
  assert.equal(propertiesFor('battery-4xaa', { chemistry: 'nimh', charge: 42 }).charge, 42);
  assert.throws(() => propertiesFor('battery-4xaa', { chemistry: 'lipo' }), RangeError);
  assert.throws(() => propertiesFor('battery-4xaa', { charge: 101 }), RangeError);
  assert.throws(() => propertiesFor('battery-4xaa', { charge: -1 }), RangeError);
});

test('bench supply and regulator properties stay inside the training range', () => {
  const bench = propertiesFor('bench-supply');
  assert.equal(bench.voltage, 5);
  assert.equal(bench.currentLimitMa, 1000);
  assert.equal(propertiesFor('bench-supply', { voltage: 12, currentLimitMa: 3000 }).voltage, 12);
  assert.throws(() => propertiesFor('bench-supply', { voltage: 13 }), RangeError);
  assert.throws(() => propertiesFor('bench-supply', { currentLimitMa: 4000 }), RangeError);
  assert.equal(propertiesFor('breadboard-regulator').outputVoltage, '3.3');
  assert.equal(propertiesFor('breadboard-regulator', { outputVoltage: '5' }).outputVoltage, '5');
  assert.throws(() => propertiesFor('breadboard-regulator', { outputVoltage: '4.2' }), RangeError);
});

test('every power part has bilingual catalogue copy and needs no firmware', () => {
  for (const id of ['usb-5v-source', 'battery-4xaa', 'bench-supply', 'breadboard-regulator']) {
    for (const lang of ['en', 'zh']) {
      const entry = catalogueEntry(id, lang);
      assert.ok(entry, id);
      assert.equal(entry.category, 'power');
      assert.notEqual(entry.name, `name.${id}`);
      assert.notEqual(entry.summary, `summary.${id}`);
      assert.equal(entry.firmwareIndependent, true);
      assert.ok(entry.voltage);
    }
  }
});

test('power part visuals keep their pin anchors and bodies', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ scale() {}, translate() {}, fillRect() {}, fillText() {}, createRadialGradient() { return { addColorStop() {} }; } });
  try {
    for (const id of ['usb-5v-source', 'battery-4xaa', 'bench-supply', 'breadboard-regulator']) {
      const visual = buildPart(PARTS[id], { onBoard: id === 'breadboard-regulator', burnt: false });
      assert.deepEqual([...visual.anchors.keys()], PARTS[id].pins.map(p => p.name), id);
      for (const pin of PARTS[id].pins) assert.equal(visual.anchors.get(pin.name)?.x, pin.x);
      dispose(visual.group);
    }
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('a fresh alkaline pack derives its open circuit, resistance and capacity', () => {
  assert.deepEqual(batterySource({ chemistry: 'alkaline', charge: 100 }), {
    voltage: BATTERY_CHEMISTRIES.alkaline.fullVoltage,
    internalResistanceOhm: BATTERY_CHEMISTRIES.alkaline.freshInternalResistanceOhm,
    currentLimitMa: BATTERY_CHEMISTRIES.alkaline.currentLimitMa,
    capacityMah: BATTERY_CHEMISTRIES.alkaline.capacityMah,
    chemistry: 'alkaline', chargePercent: 100,
  });
  const empty = batterySource({ chemistry: 'alkaline', charge: 0 });
  assert.equal(empty?.voltage, 4);
  assert.equal(empty?.internalResistanceOhm, 1.2);
  assert.equal(batterySource({ chemistry: 'nimh', charge: 100 })?.capacityMah, 2000);
  assert.equal(batterySource({ chemistry: 'nimh', charge: 100 })?.voltage, 5.6);
});

test('a USB source powers a load inside its documented limit', () => {
  const { b, id } = powered('usb-5v-source');
  const o = run(b); const r = rail(o, id);
  assert.equal(r?.status, 'ok');
  assert.ok(r.voltage > 4.98 && r.voltage < 5);
  assert.equal(o.devices.mic.status, 'ok');
});

test('battery load current drops the rail and a low charge drops it further', () => {
  const fresh = powered('battery-4xaa');
  let high = setPartProperty(fresh.b, fresh.id, 'charge', 100);
  let low = setPartProperty(fresh.b, fresh.id, 'charge', 20);
  const highRail = rail(run(high), fresh.id);
  const lowRail = rail(run(low), fresh.id);
  assert.ok(highRail && lowRail);
  assert.ok(highRail.voltage < 6 && highRail.voltage > 5.6);
  assert.ok(lowRail.voltage < highRail.voltage);
  assert.ok(lowRail.voltage < 4.8);
});

test('a low charge can drop a regulator below its output', () => {
  const added = addPart(emptyBench(), 'bench-supply', { x: -20, z: 30 });
  const reg = addPart(added.bench, 'breadboard-regulator', { x: 10, z: 30 });
  let b = addWire(reg.bench, `${added.id}:+`, `${reg.id}:VIN`, 'red');
  b = addWire(b, `${added.id}:-`, `${reg.id}:GND`, 'black');
  b = addWire(b, `${reg.id}:VOUT`, 'mic:VDD', 'red');
  b = addWire(b, `${reg.id}:GND`, 'mic:GND', 'black');
  b = setPartProperty(b, added.id, 'voltage', 4);
  const o = run(b);
  assert.equal(rail(o, reg.id)?.status, 'dropout');
  assert.ok((rail(o, reg.id)?.voltage ?? 0) > 2.8 && (rail(o, reg.id)?.voltage ?? 0) < 3);
  assert.ok(o.faults.some(f => f.code === 'regulator-dropout'));
});

test('the regulator selects 3.3 V or 5 V from sufficient input headroom', () => {
  const added = addPart(emptyBench(), 'bench-supply', { x: -20, z: 30 });
  const reg = addPart(added.bench, 'breadboard-regulator', { x: 10, z: 30 });
  let b = addWire(reg.bench, `${added.id}:+`, `${reg.id}:VIN`, 'red');
  b = addWire(b, `${added.id}:-`, `${reg.id}:GND`, 'black');
  b = addWire(b, `${reg.id}:VOUT`, 'mic:VDD', 'red');
  b = addWire(b, `${reg.id}:GND`, 'mic:GND', 'black');
  b = setPartProperty(b, added.id, 'voltage', 9);
  assert.equal(rail(run(b), reg.id)?.voltage, 3.3);
  const five = setPartProperty(b, reg.id, 'outputVoltage', '5');
  assert.equal(rail(run(five), reg.id)?.voltage, 5);
});

test('a regulator current limit is reported instead of powering the load', () => {
  const added = addPart(emptyBench(), 'bench-supply', { x: -20, z: 30 });
  const reg = addPart(added.bench, 'breadboard-regulator', { x: 10, z: 30 });
  let b = addWire(reg.bench, `${added.id}:+`, `${reg.id}:VIN`, 'red');
  b = addWire(b, `${added.id}:-`, `${reg.id}:GND`, 'black');
  b = addWire(b, `${reg.id}:VOUT`, 'mic:VDD', 'red');
  b = addWire(b, `${reg.id}:GND`, 'mic:GND', 'black');
  b = setPartProperty(b, added.id, 'voltage', 9);
  const heavy = evaluateElectrical(b, { profile: {}, mode: 'idle', devices: { ...devices, inmp441: { capabilities: [{ ...loadModel, currentsMa: { idle: 900 } }] } } });
  assert.equal(rail(heavy, reg.id)?.status, 'limited');
  assert.equal(rail(heavy, reg.id)?.voltage, 0);
  assert.ok(heavy.faults.some(f => f.code === 'source-current-limit'));
});

test('a bench supply current limit stops the load', () => {
  const { b, id } = powered('bench-supply');
  const o = run(setPartProperty(b, id, 'currentLimitMa', 50));
  assert.equal(rail(o, id)?.status, 'limited');
  assert.equal(o.devices.mic.status, 'brownout');
  assert.ok(o.faults.some(f => f.code === 'source-current-limit'));
});

test('a battery wired backwards reports reverse polarity', () => {
  const added = addPart(emptyBench(), 'battery-4xaa', { x: -20, z: 30 });
  let b = addWire(added.bench, `${added.id}:+`, 'mic:GND', 'red');
  b = addWire(b, `${added.id}:-`, 'mic:VDD', 'black');
  assert.ok(run(b).faults.some(f => f.code === 'reverse-polarity'));
});

test('joining two sources on one rail reports contention', () => {
  const usb = addPart(emptyBench(), 'usb-5v-source', { x: -20, z: 30 });
  const bench = addPart(usb.bench, 'bench-supply', { x: 20, z: 30 });
  let b = addWire(bench.bench, `${usb.id}:5V`, 'mic:VDD', 'red');
  b = addWire(b, `${usb.id}:GND`, 'mic:GND', 'black');
  b = addWire(b, `${bench.id}:+`, 'mic:VDD', 'red');
  b = addWire(b, `${bench.id}:-`, 'mic:GND', 'black');
  const o = run(b);
  assert.equal(rail(o, usb.id)?.status, 'contended');
  assert.ok(o.faults.some(f => f.code === 'source-contention'));
});

test('equal batteries joined through a rail are still flagged', () => {
  const one = addPart(emptyBench(), 'battery-4xaa', { x: -20, z: 30 });
  const two = addPart(one.bench, 'battery-4xaa', { x: 20, z: 30 });
  let b = addWire(two.bench, `${one.id}:+`, `${two.id}:+`, 'red');
  b = addWire(b, `${one.id}:+`, 'mic:VDD', 'red');
  b = addWire(b, `${one.id}:-`, `${two.id}:-`, 'black');
  b = addWire(b, `${one.id}:-`, 'mic:GND', 'black');
  assert.ok(run(b).faults.some(f => f.code === 'source-contention'));
});

test('shorted battery terminals are reported as reversed, not as a working rail', () => {
  const added = addPart(emptyBench(), 'battery-4xaa', { x: -20, z: 30 });
  const b = addWire(added.bench, `${added.id}:+`, `${added.id}:-`, 'red');
  const o = run(b);
  assert.equal(rail(o, added.id)?.status, 'reversed');
  assert.ok(o.faults.some(f => f.code === 'reverse-polarity'));
});

test('battery charge and regulator output survive save and load', () => {
  const added = addPart(emptyBench(), 'battery-4xaa', { x: -20, z: 30 });
  const reg = addPart(added.bench, 'breadboard-regulator', { x: 10, z: 30 });
  let b = setPartProperty(reg.bench, added.id, 'chemistry', 'nimh');
  b = setPartProperty(b, added.id, 'charge', 42);
  b = setPartProperty(b, reg.id, 'outputVoltage', '5');
  const loaded = load(serialize(b));
  assert.equal(loaded.placed.find(p => p.id === added.id)?.properties.chemistry, 'nimh');
  assert.equal(loaded.placed.find(p => p.id === added.id)?.properties.charge, 42);
  assert.equal(loaded.placed.find(p => p.id === reg.id)?.properties.outputVoltage, '5');
  assert.ok(batterySource({ chemistry: 'nimh', charge: 42 }));
});

test('a version 2 bench fills in the new power defaults', () => {
  const b = addPart(emptyBench(), 'battery-4xaa', { x: -20, z: 30 }).bench;
  const raw = JSON.parse(serialize(b));
  raw.v = 2;
  for (const placed of raw.placed) delete placed.properties;
  const loaded = load(JSON.stringify(raw));
  assert.equal(loaded.placed.find(p => p.part === 'battery-4xaa')?.properties.chemistry, 'alkaline');
  assert.equal(loaded.placed.find(p => p.part === 'battery-4xaa')?.properties.charge, 100);
});

test('the power lesson and its project validate', () => {
  assert.equal(POWER_LESSON.id, 'power-basics-v1');
  assert.equal(POWER_LESSON.part, 'battery-4xaa');
  assert.equal(POWER_LESSON.projectId, 'power-a-rail');
  assert.deepEqual(validateLesson(POWER_LESSON, DEVICES, PROJECTS), []);
  const project = projectById('power-a-rail');
  assert.ok(project);
  assert.equal(project.links.length, 5);
  const bench = project.steps.reduce(applyStep, startBench(emptyBench()));
  assert.deepEqual(connectionProgress(bench, project).map(link => link.status), Array(5).fill('complete'));
});

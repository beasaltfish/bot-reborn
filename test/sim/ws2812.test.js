import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, propertiesFor, setPartProperty } from '../../sim/bench.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { evaluateDevices } from '../../sim/devices/evaluate.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { WS2812_LESSON } from '../../sim/lessons/ws2812.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS, projectById } from '../../sim/projects.js';

const tolerant = { ...PROFILES[0], gpioVoltage: 5 };
function stripBench({ dout = false, ground = true } = {}) {
  let b = addPart(emptyBench(), 'ws2812-strip', { x: 0, z: 0 }).bench;
  b = addWire(b, 'strip:5V', 'esp:5V', 'red');
  if (ground) b = addWire(b, 'strip:GND', 'esp:GND', 'black');
  b = addWire(b, dout ? 'strip:DOUT' : 'strip:DIN', 'esp:GPIO6', 'green');
  return { ...b, usb: true };
}
/** @param {any} pixels */
const show = pixels => ({ stimuli: { strip: { strip: { pixels } } } });

test('the strip has documented pins and a bounded pixel property', () => {
  const part = addPart(emptyBench(), 'ws2812-strip', { x: 0, z: 0 });
  assert.deepEqual(part.bench.placed.find(p => p.id === part.id)?.properties.pixels, 8);
  assert.equal(propertiesFor('ws2812-strip', { pixels: 1 }).pixels, 1);
  assert.throws(() => propertiesFor('ws2812-strip', { pixels: 61 }), RangeError);
  assert.deepEqual(DEVICES['ws2812-strip'].firmware.actions, ['show']);
});
test('3.3 V logic on a 5 V strip is level-incompatible', () => {
  const result = evaluateDevices(stripBench(), {});
  assert.equal(result.strip.strip.state, 'level-incompatible');
  assert.ok(result.faults.some(fault => fault.code === 'logic-level-incompatible'));
});
test('a compatible strip is ready without data and active when lit', () => {
  let result = evaluateDevices(stripBench(), { profile: tolerant });
  assert.equal(result.strip.strip.state, 'ready');
  result = evaluateDevices(stripBench(), { profile: tolerant, ...show([[255, 255, 255]]) });
  assert.equal(result.strip.strip.state, 'active');
  assert.equal(result.strip.strip.currentMa, 61);
  assert.equal(evaluateDevices(stripBench(), { profile: tolerant, ...show([[0, 0, 0]]) }).strip.strip.currentMa, 1);
});
test('current grows with pixel count and white is the peak', () => {
  const result = evaluateDevices(stripBench(), { profile: tolerant, ...show(Array(8).fill([255, 255, 255])) });
  assert.equal(result.strip.strip.currentMa, 481);
});
test('wiring DOUT as the input reports the wrong direction', () => {
  const result = evaluateDevices(stripBench({ dout: true }), { profile: tolerant });
  assert.equal(result.strip.strip.state, 'no-data');
  assert.ok(result.faults.some(fault => fault.code === 'onewire-data-direction'));
});
test('a missing common ground keeps the strip off', () => {
  const result = evaluateDevices(stripBench({ ground: false }), { profile: tolerant });
  assert.equal(result.strip.strip.state, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'source-ground-missing'));
});
test('an inadequate supply browns out the strip', () => {
  const src = addPart(emptyBench(), 'bench-supply', { x: -20, z: 0 });
  const strip = addPart(src.bench, 'ws2812-strip', { x: 10, z: 0 });
  let b = addWire(strip.bench, `${src.id}:+`, 'strip:5V', 'red');
  b = addWire(b, `${src.id}:-`, 'esp:GND', 'black');
  b = addWire(b, 'strip:GND', 'esp:GND', 'black');
  b = addWire(b, 'strip:DIN', 'esp:GPIO6', 'green');
  b = setPartProperty(b, 'bench', 'currentLimitMa', 100);
  const result = evaluateDevices({ ...b, usb: true }, { profile: tolerant, stimuli: { strip: { strip: { pixels: [[255, 255, 255], [255, 255, 255]] } } } });
  assert.equal(result.strip.strip.state, 'brownout');
  assert.ok(result.faults.some(fault => fault.code === 'rail-brownout'));
});
test('the strip lesson and status-light-strip project validate', () => {
  assert.deepEqual(validateLesson(WS2812_LESSON, DEVICES, PROJECTS), []);
  const project = projectById('status-light-strip');
  assert.ok(project);
  assert.equal(project.links.length, 3);
});

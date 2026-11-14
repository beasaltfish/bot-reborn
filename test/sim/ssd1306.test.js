import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, propertiesFor } from '../../sim/bench.js';
import { PARTS } from '../../sim/parts.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { evaluateDevices } from '../../sim/devices/evaluate.js';
import { SSD1306_LESSON } from '../../sim/lessons/ssd1306.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { startBench, applyStep } from '../../sim/recipes.js';
import { emptyFrame, setPixel, pixel, textFrame, formatReadings, displayAddress, SSD1306_WIDTH, SSD1306_HEIGHT } from '../../sim/devices/ssd1306.js';

function displayBench(address = '0x3c', swap = false) {
  let b = addPart(emptyBench(), 'ssd1306', { x: 0, z: 0 }).bench;
  b = addWire(b, 'oled:VCC', 'esp:3V3', 'red');
  b = addWire(b, 'oled:GND', 'esp:GND', 'black');
  b = addWire(b, 'oled:SDA', swap ? 'esp:GPIO2' : 'esp:GPIO1', 'green');
  b = addWire(b, 'oled:SCL', swap ? 'esp:GPIO1' : 'esp:GPIO2', 'yellow');
  b = { ...b, usb: true };
  return address === '0x3c' ? b : { ...b, placed: b.placed.map(part => part.id === 'oled' ? { ...part, properties: propertiesFor('ssd1306', { address }) } : part) };
}

test('the SSD1306 has the documented pins, address property and firmware contract', () => {
  assert.deepEqual(PARTS.ssd1306.pins.map(pin => pin.name), ['GND', 'VCC', 'SCL', 'SDA']);
  assert.equal(propertiesFor('ssd1306').address, '0x3c');
  assert.equal(propertiesFor('ssd1306', { address: '0x3d' }).address, '0x3d');
  assert.throws(() => propertiesFor('ssd1306', { address: '0x3e' }), RangeError);
  assert.deepEqual(DEVICES.ssd1306.firmware.actions, ['drawFrame']);
  assert.deepEqual(DEVICES.ssd1306.firmware.telemetry, []);
  assert.equal(displayAddress('0x3c'), 0x3c);
  assert.equal(displayAddress('0x3e'), null);
});

test('frames are 128x64 monochrome and text drawing is deterministic', () => {
  const blank = emptyFrame();
  assert.equal(blank.length, SSD1306_WIDTH * SSD1306_HEIGHT / 8);
  assert.ok(blank.every(byte => byte === 0));
  setPixel(blank, 0, 0);
  assert.equal(pixel(blank, 0, 0), true);
  assert.equal(pixel(blank, 1, 0), false);
  setPixel(blank, 127, 63);
  assert.equal(pixel(blank, 127, 63), true);
  const first = textFrame(['T 24.5 C']);
  const second = textFrame(['T 24.5 C']);
  assert.deepEqual([...first.frame], [...second.frame]);
  assert.ok(first.frame.some(byte => byte !== 0));
  assert.equal(first.lines[0], 'T 24.5 C');
});

test('readings format into three bounded display lines', () => {
  const view = formatReadings({ temperatureC: 24.53, humidityPct: 50.4, pressureHpa: 1013.2 });
  assert.deepEqual(view.lines, ['T 24.5 C', 'H 50 %', 'P 1013 HPA']);
  assert.ok(view.frame.some(byte => byte !== 0));
});

test('a wired display is ready with a blank frame and draws only on request', () => {
  let result = evaluateDevices(displayBench());
  assert.equal(result.display.oled.state, 'ready');
  assert.ok(result.display.oled.frame.every(byte => byte === 0));
  result = evaluateDevices(displayBench(), { stimuli: { displays: { oled: { lines: ['T 24.5 C', 'H 50 %'] } } } });
  assert.deepEqual(result.display.oled.lines, ['T 24.5 C', 'H 50 %']);
  assert.ok(result.display.oled.frame.some(byte => byte !== 0));
});

test('an unpowered display is off', () => {
  const b = { ...displayBench(), usb: false };
  assert.equal(evaluateDevices(b).display.oled.state, 'off');
});

test('swapped SDA and SCL are a bus fault', () => {
  const result = evaluateDevices(displayBench('0x3c', true));
  assert.equal(result.display.oled.state, 'bus-fault');
  assert.ok(result.faults.some(fault => fault.code === 'i2c-sda-scl-swapped'));
});

test('two displays on the same address conflict', () => {
  let b = displayBench();
  b = addPart(b, 'ssd1306', { x: 15, z: 0 }).bench;
  for (const [a, target] of /** @type {[string,string][]} */ ([['oled2:VCC', 'esp:3V3'], ['oled2:GND', 'esp:GND'], ['oled2:SDA', 'esp:GPIO1'], ['oled2:SCL', 'esp:GPIO2']])) b = addWire(b, a, target, 'yellow');
  const result = evaluateDevices(b);
  assert.equal(result.display.oled.state, 'address-conflict');
  assert.equal(result.display.oled2.state, 'address-conflict');
  assert.ok(result.faults.some(fault => fault.code === 'i2c-address-conflict'));
});

test('the OLED lesson and environment-display project validate', () => {
  assert.deepEqual(validateLesson(SSD1306_LESSON, DEVICES, PROJECTS), []);
  const project = projectById('environment-display');
  assert.ok(project);
  assert.equal(project.links.length, 8);
  const bench = project.steps.reduce(applyStep, startBench(emptyBench()));
  assert.deepEqual(connectionProgress(bench, project).map(link => link.status), Array(8).fill('complete'));
});

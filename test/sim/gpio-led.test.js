import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { evaluateGpioLed } from '../../sim/electrical/led-bench.js';

function highSide(ohms = 220) {
  let b = emptyBench();
  b = addPart(b, 'led-5mm', { x: 10, z: 30 }).bench;
  b = addPart(b, 'resistor', { x: 0, z: 30 }).bench;
  b = { ...b, placed: b.placed.map((p) => (p.id === 'r' ? { ...p, properties: { ...p.properties, ohms } } : p)) };
  return addWire(addWire(addWire(b, 'esp:GPIO5', 'r:1', 'red'), 'r:2', 'led:A', 'red'), 'led:K', 'esp:GND', 'black');
}

test('GPIO5 high lights the LED through the resistor', () => {
  const led = evaluateGpioLed(highSide(), 'led', { GPIO5: 'high' });
  assert.equal(led.state, 'on');
  assert.ok(led.currentMa > 0);
});

test('low and high-z leave a high-side LED dark', () => {
  assert.equal(evaluateGpioLed(highSide(), 'led', { GPIO5: 'low' }).state, 'off');
  assert.equal(evaluateGpioLed(highSide(), 'led', { GPIO5: 'high-z' }).state, 'off');
});

test('over-current is diagnosed, not assumed safe', () => {
  assert.equal(evaluateGpioLed(highSide(10), 'led', { GPIO5: 'high' }).state, 'overcurrent');
});

import { evaluateBench } from '../../sim/devices/evaluate.js';

test('the evaluated bench lights a GPIO LED and never assumes a dark one is safe', () => {
  const bench = { ...highSide(), usb: true };
  const on = evaluateBench(bench, { gpioOutputs: { GPIO5: 'high' } }).engineering;
  assert.equal(on.leds.led.state, 'on');
  const off = evaluateBench(bench, { gpioOutputs: { GPIO5: 'low' } }).engineering;
  assert.equal(off.leds.led.state, 'off');
});

test('a GPIO overcurrent is its own diagnosis and burns the LED', () => {
  const bench = { ...highSide(10), usb: true };
  const result = evaluateBench(bench, { gpioOutputs: { GPIO5: 'high' } });
  assert.ok(result.engineering.faults.some((f) => f.code === 'gpio-overcurrent' && f.instances.includes('led')));
  assert.ok(result.burns.includes('led'));
});

import { evaluateDevices } from '../../sim/devices/evaluate.js';

test('an unknown owner or an uninitialised board LED shows no light', () => {
  const bench = { ...highSide(), usb: true };
  const high = /** @type {Record<string, 'high'>} */ ({ GPIO5: 'high' });
  const unknown = evaluateDevices(bench, { gpioOutputs: high, ownership: { led: 'unknown' } });
  assert.equal(unknown.leds.led, undefined);
  const waiting = evaluateDevices(bench, { gpioOutputs: high, ownership: { led: 'board' }, deviceStates: {} });
  assert.equal(waiting.leds.led, undefined);
  const active = evaluateDevices(bench, { gpioOutputs: high, ownership: { led: 'board' }, deviceStates: { led: 'active' } });
  assert.equal(active.leds.led.state, 'on');
  const circuit = evaluateDevices(bench, { gpioOutputs: high, ownership: { led: 'circuit' } });
  assert.equal(circuit.leds.led.state, 'on');
});

import { createBenchIo } from '../../sim/bench-io.js';
import { liveDiagnosis } from '../../sim/live-diagnosis.js';

const BOARD_LED = /** @type {const} */ ({ led: 'board' });

test('a plugin pin lights a board-owned LED the firmware never claimed', () => {
  const bench = { ...highSide(), usb: true };
  /** @type {Record<string, 'high'|'low'|'high-z'>} */
  const gpioOutputs = { GPIO5: 'high' };
  const options = { gpioOutputs, ownership: BOARD_LED, deviceStates: {} };
  assert.equal(evaluateBench(bench, options).engineering.leds.led, undefined, 'no claim, no light');
  const on = evaluateBench(bench, { ...options, ioPins: new Set([5]) }).engineering;
  assert.equal(on.leds.led.state, 'on');
});

test('the IO adapter lights the LED, and disconnect restores safe and turns it off', async () => {
  const bench = { ...highSide(), usb: true };
  /** @type {Record<string, 'high'|'low'|'high-z'>} */
  const gpioOutputs = {};
  const ioPins = new Set();
  const io = createBenchIo({
    writePin: (pin, level) => {
      gpioOutputs[`GPIO${pin}`] = level ? 'high' : 'low';
      ioPins.add(pin);
    },
    readPin: () => 'LOW',
  });
  /** @param {Set<number>} pins */
  const evaluate = (pins) => evaluateBench(bench, {
    gpioOutputs, ioPins: pins, ownership: BOARD_LED, deviceStates: { led: 'active' },
  }).engineering;

  await io.run({ op: 'pin.write', args: { pin: 5, level: 1 }, safe: 0 });
  assert.equal(evaluate(ioPins).leds.led.state, 'on');
  await io.disconnect();
  // sim/main.js's releaseBenchPins does both: restore, then stop admitting.
  ioPins.clear();
  assert.equal(io.level(5), 0);
  assert.equal(evaluate(ioPins).leds.led.state, 'off');
});

test('a plugin pin shorting an LED is diagnosed, not silently ignored', () => {
  // Only the board and the LED circuit, so the first hint is the short itself.
  const wired = highSide(10);
  const bench = {
    ...wired, usb: true,
    placed: wired.placed.filter((p) => !['inmp441', 'max98357a', 'speaker'].includes(p.part)),
  };
  const evaluated = evaluateBench(bench, {
    gpioOutputs: { GPIO5: 'high' }, ioPins: new Set([5]), ownership: BOARD_LED, deviceStates: {},
  });
  assert.equal(evaluated.engineering.leds.led.state, 'overcurrent');
  assert.ok(evaluated.engineering.faults.some((f) => f.code === 'gpio-overcurrent' && f.instances.includes('led')));
  assert.match(liveDiagnosis(bench, 'en', evaluated)?.text ?? '', /GPIO pin/);
});

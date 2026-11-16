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

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { evaluateDevices } from '../../sim/devices/evaluate.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { SG90_LESSON } from '../../sim/lessons/sg90.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS, projectById } from '../../sim/projects.js';

function servoBench() {
  let b = addPart(emptyBench(), 'sg90', { x: 0, z: 0 }).bench;
  b = addWire(b, 'servo:VCC', 'esp:5V', 'red');
  b = addWire(b, 'servo:GND', 'esp:GND', 'black');
  b = addWire(b, 'servo:SIG', 'esp:GPIO6', 'yellow');
  return { ...b, usb: true };
}
test('an idle powered servo is ready with idle current', () => {
  const result = evaluateDevices(servoBench());
  assert.equal(result.servo.servo.state, 'ready');
  assert.equal(result.servo.servo.currentMa, 5);
  assert.equal(result.servo.servo.supplyVoltage, 5);
});
test('an angle command moves the servo and raises current', () => {
  const result = evaluateDevices(servoBench(), { stimuli: { servo: { servo: { angle: 90 } } } });
  assert.equal(result.servo.servo.state, 'moving');
  assert.equal(result.servo.servo.pulseUs, 1450);
  assert.equal(result.servo.servo.currentMa, 200);
});
test('a stalled load draws the stall current', () => {
  const result = evaluateDevices(servoBench(), { stimuli: { servo: { servo: { angle: 90, stalled: true } } } });
  assert.equal(result.servo.servo.state, 'stalled');
  assert.equal(result.servo.servo.currentMa, 700);
});
test('an unpowered servo is off', () => {
  assert.equal(evaluateDevices({ ...servoBench(), usb: false }).servo.servo.state, 'off');
});
test('VCC driven from a GPIO is refused', () => {
  let b = addPart(emptyBench(), 'sg90', { x: 0, z: 0 }).bench;
  b = addWire(b, 'servo:VCC', 'esp:GPIO7', 'red');
  b = addWire(b, 'servo:GND', 'esp:GND', 'black');
  b = addWire(b, 'servo:SIG', 'esp:GPIO6', 'yellow');
  b = { ...b, usb: true };
  const result = evaluateDevices(b);
  assert.ok(result.faults.some(fault => fault.code === 'servo-gpio-power'));
  assert.notEqual(result.servo.servo.state, 'ready');
});
test('a missing common ground is reported', () => {
  let b = addPart(emptyBench(), 'sg90', { x: 0, z: 0 }).bench;
  b = addWire(b, 'servo:VCC', 'esp:5V', 'red');
  b = addWire(b, 'servo:SIG', 'esp:GPIO6', 'yellow');
  b = { ...b, usb: true };
  const result = evaluateDevices(b);
  assert.ok(result.faults.some(fault => fault.code === 'source-ground-missing'));
});
test('an independent 5 V supply powers the servo', () => {
  const src = addPart(emptyBench(), 'bench-supply', { x: -20, z: 0 });
  const servo = addPart(src.bench, 'sg90', { x: 10, z: 0 });
  let b = addWire(servo.bench, `${src.id}:+`, 'servo:VCC', 'red');
  b = addWire(b, `${src.id}:-`, 'esp:GND', 'black');
  b = addWire(b, 'servo:GND', 'esp:GND', 'black');
  b = addWire(b, 'servo:SIG', 'esp:GPIO6', 'yellow');
  const result = evaluateDevices({ ...b, usb: true }, { stimuli: { servo: { servo: { angle: 45 } } } });
  assert.equal(result.servo.servo.supplyVoltage, 5);
  assert.equal(result.servo.servo.state, 'moving');
});
test('the servo lesson and proximity-servo project validate', () => {
  assert.deepEqual(validateLesson(SG90_LESSON, DEVICES, PROJECTS), []);
  const project = projectById('proximity-servo');
  assert.ok(project);
  assert.equal(project.links.length, 7);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { evaluateDevices } from '../../sim/devices/evaluate.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { TB6612_LESSON } from '../../sim/lessons/tb6612.js';
import { DC_MOTOR_LESSON } from '../../sim/lessons/dc-motor.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { PROJECTS, projectById } from '../../sim/projects.js';

/** @param {{vm?:string,vcc?:string,stby?:string,crossed?:boolean,ain2?:string,pwma?:string,ground?:boolean}} [options] */
function motorBench(options = {}) {
  const { vm = 'esp:5V', vcc = 'esp:3V3', stby = 'esp:3V3', crossed = false, ain2 = 'esp:GPIO5', pwma = 'esp:GPIO6', ground = true } = options;
  let b = addPart(emptyBench(), 'tb6612fng', { x: 0, z: 0 }).bench;
  b = addPart(b, 'dc-motor-small', { x: 30, z: 0 }).bench;
  b = addWire(b, 'drv:VM', vm, 'red');
  b = addWire(b, 'drv:VCC', vcc, 'red');
  if (ground) b = addWire(b, 'drv:GND2', 'esp:GND', 'black');
  b = addWire(b, 'drv:STBY', stby, 'yellow');
  b = addWire(b, 'drv:AIN1', 'esp:GPIO4', 'yellow');
  b = addWire(b, 'drv:AIN2', ain2, 'yellow');
  b = addWire(b, 'drv:PWMA', pwma, 'yellow');
  b = addWire(b, 'motor:+', crossed ? 'drv:AO2' : 'drv:AO1', 'orange');
  b = addWire(b, 'motor:-', crossed ? 'drv:AO1' : 'drv:AO2', 'orange');
  return { ...b, usb: true };
}
/** @param {string} direction @param {Record<string, unknown>} [extra] */
const drive = (direction, extra = {}) => ({ stimuli: { motor: { drv: { direction, speed: 0.5, ...extra } } } });

test('forward and reverse drive the motor with idle current', () => {
  let result = evaluateDevices(motorBench(), drive('forward'));
  assert.equal(result.motor.motor.state, 'forward');
  assert.equal(result.motor.motor.rpmRatio, 0.5);
  assert.equal(result.motor.motor.currentMa, 100);
  result = evaluateDevices(motorBench(), drive('reverse'));
  assert.equal(result.motor.motor.state, 'reverse');
});
test('crossed motor terminals reverse the direction only', () => {
  assert.equal(evaluateDevices(motorBench({ crossed: true }), drive('forward')).motor.motor.state, 'reverse');
});
test('coast and brake stop the motor without current', () => {
  for (const direction of ['coast', 'brake']) {
    const result = evaluateDevices(motorBench(), drive(direction));
    assert.equal(result.motor.motor.state, direction);
    assert.equal(result.motor.motor.currentMa, 0);
    assert.equal(result.motor.motor.rpmRatio, 0);
  }
});
test('STBY low keeps the driver off', () => {
  const result = evaluateDevices(motorBench({ stby: 'esp:GND' }), drive('forward'));
  assert.equal(result.motor.motor.state, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'motor-standby'));
});
test('missing motor or logic supply is reported', () => {
  let b = motorBench();
  b = { ...b, wires: b.wires.filter(wire => !(wire.a === 'drv:VM' || wire.b === 'drv:VM')) };
  const result = evaluateDevices(b, drive('forward'));
  assert.equal(result.motor.motor.state, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'device-unpowered'));
});
test('VM on a GPIO is refused', () => {
  const result = evaluateDevices(motorBench({ vm: 'esp:GPIO7' }), drive('forward'));
  assert.ok(result.faults.some(fault => fault.code === 'driver-gpio-power'));
  assert.notEqual(result.motor.motor.state, 'forward');
});
test('a missing common ground keeps the motor off', () => {
  const result = evaluateDevices(motorBench({ ground: false }), drive('forward'));
  assert.equal(result.motor.motor.state, 'off');
  assert.ok(result.faults.some(fault => fault.code === 'source-ground-missing'));
});
test('a stalled load draws stall current', () => {
  const result = evaluateDevices(motorBench(), drive('forward', { load: 'stall' }));
  assert.equal(result.motor.motor.state, 'stalled');
  assert.equal(result.motor.motor.currentMa, 1200);
  assert.ok(result.faults.some(fault => fault.code === 'motor-stall-current'));
});
test('both bridge inputs on one GPIO are destructive', () => {
  const result = evaluateDevices(motorBench({ ain2: 'esp:GPIO4' }), drive('forward'));
  assert.ok(result.faults.some(fault => fault.code === 'motor-bridge-shorted' && fault.severity === 'destructive'));
});
test('a non-PWM input pin is reported', () => {
  const result = evaluateDevices(motorBench({ pwma: 'esp:GPIO46' }), drive('forward'));
  assert.ok(result.faults.some(fault => fault.code === 'motor-pwm-pin'));
});
test('a burnt motor stays burnt', () => {
  const b = motorBench();
  b.placed = b.placed.map(part => part.id === 'motor' ? { ...part, burnt: true } : part);
  assert.equal(evaluateDevices(b, drive('forward')).motor.motor.state, 'burnt');
});
test('the two motor lessons and guided project validate', () => {
  for (const lesson of [TB6612_LESSON, DC_MOTOR_LESSON]) assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
  assert.ok(projectById('motor-driver-basics'));
});

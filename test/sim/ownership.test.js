import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addPart, addWire } from '../../sim/bench.js';
import { ownershipOf, ownershipIssues } from '../../sim/firmware/ownership.js';

/** @param {any} b @param {[string, string][]} list */
function wires(b, list) {
  for (const [a, z] of list) b = addWire(b, a, z, 'red');
  return b;
}

function gpioLed(usb = false) {
  let b = emptyBench();
  b = addPart(b, 'led-5mm', { x: 10, z: 30 }).bench;
  b = addPart(b, 'resistor', { x: 0, z: 30 }).bench;
  b = wires(b, [['esp:GPIO5', 'r:1'], ['r:2', 'led:A'], ['led:K', 'esp:GND']]);
  return { ...b, usb };
}

function sourceLed() {
  let b = emptyBench();
  b = addPart(b, 'led-5mm', { x: 10, z: 30 }).bench;
  b = addPart(b, 'resistor', { x: 0, z: 30 }).bench;
  b = addPart(b, 'dc-source', { x: -20, z: 30 }).bench;
  return wires(b, [['src:+', 'r:1'], ['r:2', 'led:A'], ['led:K', 'src:-']]);
}

function motor(outputs = ['AO1', 'AO2']) {
  let b = emptyBench();
  b = addPart(b, 'tb6612fng', { x: 0, z: 30 }).bench;
  b = addPart(b, 'dc-motor-small', { x: 20, z: 30 }).bench;
  b = wires(b, [
    ['esp:GPIO4', 'drv:AIN1'], ['esp:GPIO5', 'drv:AIN2'], ['esp:GPIO6', 'drv:PWMA'], ['esp:3V3', 'drv:STBY'],
    ['drv:VM', 'esp:5V'], ['drv:VCC', 'esp:3V3'], ['drv:GND', 'esp:GND'], ['drv:GND2', 'esp:GND'],
    ['drv:' + outputs[0], 'motor:+'], ['drv:' + outputs[1], 'motor:-'],
  ]);
  return b;
}

test('GPIO through one resistor to an LED is board', () => {
  assert.equal(ownershipOf(gpioLed()).led, 'board');
});

test('an independent source and resistor LED is circuit', () => {
  assert.equal(ownershipOf(sourceLed()).led, 'circuit');
});

test('a motor on TB6612 AO1/AO2 is board; on BO1/BO2 is unknown', () => {
  assert.equal(ownershipOf(motor(['AO1', 'AO2'])).motor, 'board');
  assert.equal(ownershipOf(motor(['BO1', 'BO2'])).motor, 'unknown');
});

test('an externally powered servo with a GPIO signal is board', () => {
  let b = emptyBench();
  b = addPart(b, 'sg90', { x: 10, z: 30 }).bench;
  b = addPart(b, 'dc-source', { x: -20, z: 30 }).bench;
  b = wires(b, [['src:+', 'servo:VCC'], ['src:-', 'servo:GND'], ['servo:GND', 'esp:GND'], ['servo:SIG', 'esp:GPIO7']]);
  assert.equal(ownershipOf(b).servo, 'board');
});

test('a control net tied to a supply rail is unknown with ownership-unknown', () => {
  let b = emptyBench();
  b = addPart(b, 'led-5mm', { x: 10, z: 30 }).bench;
  b = addPart(b, 'dc-source', { x: -20, z: 30 }).bench;
  b = wires(b, [['esp:GPIO5', 'led:A'], ['src:+', 'led:A'], ['led:K', 'esp:GND']]);
  assert.equal(ownershipOf(b).led, 'unknown');
  assert.ok(ownershipIssues(b).some((f) => f.code === 'ownership-unknown' && f.instances.includes('led')));
});

test('power state and firmware do not change the verdict; rewiring does', () => {
  assert.equal(ownershipOf(gpioLed(false)).led, 'board');
  assert.equal(ownershipOf(gpioLed(true)).led, 'board');
  let b = gpioLed();
  b = { ...b, wires: b.wires.filter((w) => !(w.a === 'r:2' || w.b === 'r:2')) };
  assert.equal(ownershipOf(b).led, 'unknown');
  assert.equal(ownershipOf(sourceLed()).led, 'circuit');
});

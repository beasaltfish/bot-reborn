import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { blockingBoardPowerFault, initialDriveActions } from '../../sim/board-power-gate.js';

test('a contested powered ESP32 rail blocks starting the body', () => {
  let b = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  b = addWire(b, 'src:+', 'esp:3V3', 'red');
  b = addWire(b, 'src:-', 'esp:GND', 'black');
  const result = evaluateBench(b);
  assert.equal(result.legacy.esp, 'ok');
  assert.equal(blockingBoardPowerFault(b, result)?.code, 'source-contention');
});

test('a board power conflict suppresses automatic toy motion', () => {
  let b = { ...addPart(emptyBench(), 'toy', { x: 0, z: 0 }).bench, usb: true };
  for (const [a, z] of [['toy:GND', 'esp:GND'], ['toy:U3A', 'esp:3V3'], ['toy:U3B', 'esp:GPIO5'], ['toy:U5A', 'esp:GPIO6'], ['toy:U5B', 'esp:GPIO7']]) b = addWire(b, a, z, 'red');
  const healthy = evaluateBench(b);
  assert.equal(healthy.legacy.toys.toy.action.wheels, 'forward');
  assert.equal(initialDriveActions(b, healthy).length, 1);
  b = addPart(b, 'dc-source', { x: 0, z: 0 }).bench;
  b = addWire(b, 'src:+', 'esp:3V3', 'red');
  b = addWire(b, 'src:-', 'esp:GND', 'black');
  const unsafe = evaluateBench(b);
  assert.equal(unsafe.legacy.toys.toy.action.wheels, 'forward');
  assert.deepEqual(initialDriveActions(b, unsafe), []);
});

test('unrelated source contention does not block an otherwise healthy ESP32', () => {
  let b = { ...emptyBench(), usb: true };
  b = addPart(b, 'dc-source', { x: 0, z: 0 }).bench;
  b = addPart(b, 'dc-source', { x: 0, z: 0 }).bench;
  b = addWire(b, 'src:+', 'src2:+', 'red');
  b = addWire(b, 'src:-', 'src2:-', 'black');
  const result = evaluateBench(b);
  assert.ok(result.faults.some(f => f.code === 'source-contention'));
  assert.equal(blockingBoardPowerFault(b, result), null);
});

test('unsupported electrical faults involving the board block while unrelated ones do not', () => {
  const b = { ...emptyBench(), usb: true };
  const result = evaluateBench(b);
  const fault = { code: 'unsupported-electrical-network', instances: ['esp'], points: ['esp:3V3'] };
  assert.equal(blockingBoardPowerFault(b, { ...result, faults: [fault] })?.code, fault.code);
  assert.equal(blockingBoardPowerFault(b, { ...result, faults: [{ ...fault, instances: ['src'], points: ['src:+'] }] }), null);
  assert.equal(blockingBoardPowerFault(b, { ...result, faults: [{ ...fault, instances: ['src'], points: ['esp:3V3'] }] })?.code, fault.code);
  assert.equal(blockingBoardPowerFault(b, { ...result, faults: [{ ...fault, instances: ['src'], points: ['esp:GND'] }] }), null);
});

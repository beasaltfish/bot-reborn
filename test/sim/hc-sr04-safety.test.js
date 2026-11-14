import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, setPartProperty } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { blockingBoardPowerFault } from '../../sim/board-power-gate.js';
import { createPowerInterlock } from '../../sim/power-interlock.js';

function sensor() { return addPart(emptyBench(), 'hc-sr04', { x: 0, z: 30 }).bench; }
/** @param {import('../../sim/bench.js').Bench} b @param {string} a @param {string} c */
const wire = (b, a, c) => addWire(b, a, c, 'yellow');

test('5 V HC-SR04 ECHO directly connected to GPIO warns and blocks the powered board', () => {
  let bench = { ...sensor(), usb: true };
  bench = wire(wire(bench, 'sonar:VCC', 'esp:5V'), 'sonar:ECHO', 'esp:GPIO4');
  const result = evaluateBench(bench);
  const fault = result.faults.find(item => item.code === 'logic-level-incompatible' && item.points.includes('sonar:ECHO'));
  assert.ok(fault?.points.includes('esp:GPIO4'));
  assert.ok(blockingBoardPowerFault(bench, result));
});

test('connecting powered ECHO while running stops and latches the session', () => {
  let bench = wire({ ...sensor(), usb: true }, 'sonar:VCC', 'esp:5V');
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  bench = wire(bench, 'sonar:ECHO', 'esp:GPIO4');
  assert.equal(interlock.observe(bench, evaluateBench(bench))?.code, 'logic-level-incompatible');
  assert.equal(stops, 1);
  assert.equal(interlock.tripped(), true);
});

test('a resistor in ECHO or sensor supply is unsupported instead of assumed safe', () => {
  let bench = addPart({ ...sensor(), usb: true }, 'resistor', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['sonar:VCC', 'esp:5V'], ['sonar:ECHO', 'r:1'], ['r:2', 'esp:GPIO4']]) bench = wire(bench, a, b);
  const result = evaluateBench(bench);
  const fault = result.faults.find(item => item.code === 'unsupported-electrical-network' && item.points.includes('sonar:ECHO'));
  assert.ok(fault?.points.includes('r:1') && fault.points.includes('r:2'));
  assert.ok(blockingBoardPowerFault(bench, result));
});

test('independent high supply is checked even when USB is disconnected', () => {
  let bench = addPart(sensor(), 'dc-source', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['src:+', 'sonar:VCC'], ['src:-', 'esp:GND'], ['sonar:ECHO', 'esp:GPIO4']]) bench = wire(bench, a, b);
  assert.ok(evaluateBench(bench).faults.some(item => item.code === 'logic-level-incompatible' && item.points.includes('sonar:ECHO')));
  bench = setPartProperty(bench, 'src', 'voltage', 3.3);
  assert.ok(!evaluateBench(bench).faults.some(item => item.code === 'logic-level-incompatible' && item.points.includes('sonar:ECHO')));
});

test('unconnected ECHO does not make a 5 V supply a GPIO fault', () => {
  const bench = wire({ ...sensor(), usb: true }, 'sonar:VCC', 'esp:5V');
  assert.ok(!evaluateBench(bench).faults.some(item => item.code === 'logic-level-incompatible' && item.points.includes('sonar:ECHO')));
});

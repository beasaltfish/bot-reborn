import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { blockingBoardPowerFault } from '../../sim/board-power-gate.js';
import { createPowerInterlock } from '../../sim/power-interlock.js';
import { PROFILES } from '../../sim/devices/profiles.js';

test('direct onboard 5 V on GPIO is diagnosed and blocks startup', () => {
  const bench = addWire({ ...emptyBench(), usb: true }, 'esp:5V', 'esp:GPIO4', 'red');
  const result = evaluateBench(bench);
  const fault = result.faults.find(item => item.code === 'logic-level-incompatible');
  assert.ok(fault?.points.includes('esp:5V') && fault.points.includes('esp:GPIO4'));
  assert.equal(blockingBoardPowerFault(bench, result)?.code, 'logic-level-incompatible');
});

test('onboard 5 V through resistors to GPIO is unsupported, not treated as a safe divider', () => {
  let bench = addPart({ ...emptyBench(), usb: true }, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(addWire(bench, 'esp:5V', 'r:1', 'red'), 'r:2', 'esp:GPIO4', 'yellow');
  const result = evaluateBench(bench);
  const fault = result.faults.find(item => item.code === 'unsupported-electrical-network' && item.points.includes('esp:GPIO4'));
  assert.ok(fault?.points.includes('r:1') && fault.points.includes('r:2'));
  assert.ok(blockingBoardPowerFault(bench, result));
  assert.ok(!result.faults.some(item => item.code === 'logic-level-incompatible' && item.points.includes('esp:GPIO4')));
});

test('an onboard 5 V to GPIO wire added while running trips the latch', () => {
  let bench = { ...emptyBench(), usb: true };
  let stops = 0;
  const interlock = createPowerInterlock(() => { stops++; });
  interlock.arm(bench, evaluateBench(bench));
  bench = addWire(bench, 'esp:5V', 'esp:GPIO4', 'red');
  assert.equal(interlock.observe(bench, evaluateBench(bench))?.code, 'logic-level-incompatible');
  assert.equal(stops, 1);
  assert.equal(interlock.tripped(), true);
});

test('3.3 V or an unpowered board is not misdiagnosed as 5 V exposure', () => {
  const safeVoltage = addWire({ ...emptyBench(), usb: true }, 'esp:3V3', 'esp:GPIO4', 'red');
  assert.ok(!evaluateBench(safeVoltage).faults.some(item => item.code === 'logic-level-incompatible'));
  const off = addWire(emptyBench(), 'esp:5V', 'esp:GPIO4', 'red');
  assert.ok(!evaluateBench(off).faults.some(item => item.code === 'logic-level-incompatible'));
  const unknown = evaluateBench({ ...off, usb: true }, { profile: { ...PROFILES[0], gpioVoltage: NaN } });
  assert.ok(unknown.faults.some(item => item.code === 'unsupported-electrical-network' && item.points.includes('esp:GPIO4')));
});

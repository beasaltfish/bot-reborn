import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire, removeWire } from '../../sim/bench.js';
import { liveDiagnosis } from '../../sim/live-diagnosis.js';

test('powered wire edits update and clear the short-rail diagnosis', () => {
  const base = { ...emptyBench(), usb: true };
  const shorted = addWire(base, 'esp:3V3', 'esp:GND', 'red');
  const fault = liveDiagnosis(shorted);
  assert.match(fault?.text ?? '', /resetting/);
  assert.deepEqual(new Set(fault?.points), new Set(['esp:3V3', 'esp:GND']));
  const wire = shorted.wires.at(-1);
  assert.ok(wire);
  const repaired = removeWire(shorted, wire.id);
  assert.doesNotMatch(liveDiagnosis(repaired)?.text ?? '', /resetting/);
});

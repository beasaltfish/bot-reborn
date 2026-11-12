import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, setPartProperty } from '../../sim/bench.js';
import { analyzeDividerBench } from '../../sim/electrical/divider-bench-analysis.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { blockingBoardPowerFault } from '../../sim/board-power-gate.js';

function fixture() {
  let b = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 30 }).bench;
  b = addPart(addPart(b, 'resistor', { x: 0, z: 0 }).bench, 'resistor', { x: 0, z: 0 }).bench;
  b = setPartProperty(setPartProperty(b, 'r', 'ohms', 2200), 'r2', 'ohms', 3300);
  for (const [a, c] of [['sonar:ECHO', 'r:1'], ['r:2', 'esp:GPIO4'], ['r2:1', 'esp:GPIO4'], ['r2:2', 'esp:GND'], ['sonar:GND', 'esp:GND']]) b = addWire(b, a, c, 'yellow');
  return b;
}
const points = { source: 'sonar:ECHO', output: 'esp:GPIO4', ground: 'esp:GND', sourceGround: 'sonar:GND' };
const assumptions = () => ({ sourceVoltage: { min: 4.9, max: 5.1 }, sourceResistanceOhm: { min: 0, max: 100 }, resistorTolerance: 0.05, inputLeakageUa: { min: -10, max: 10 }, inputLimits: { minVoltage: 0, maxVoltage: 3.6, highMinVoltage: 2.3 } });

test('analyzes only a recognized divider under explicit caller-supplied assumptions', () => {
  const result = analyzeDividerBench(fixture(), points, assumptions());
  assert.equal(result.kind, 'evaluated');
  if (result.kind !== 'evaluated') throw Error('not evaluated');
  assert.equal(result.voltage.status, 'within-declared-bounds');
  assert.deepEqual([result.topology.upper, result.topology.lower], ['r', 'r2']);
});

test('invalid assumptions or an extra branch cannot produce an analysis', () => {
  const invalid = assumptions(); invalid.resistorTolerance = NaN;
  assert.equal(analyzeDividerBench(fixture(), points, invalid).kind, 'unsupported');
  let bench = addPart(fixture(), 'led-5mm', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'led:A', 'esp:GPIO4', 'yellow');
  assert.equal(analyzeDividerBench(bench, points, assumptions()).kind, 'unsupported');
});

test('source ground must be a real pin on the source and share the divider reference', () => {
  const bench = fixture();
  const groundWire = bench.wires.find(wire => wire.a === 'sonar:GND');
  assert.ok(groundWire);
  const ungrounded = { ...bench, wires: bench.wires.filter(wire => wire !== groundWire) };
  assert.equal(analyzeDividerBench(ungrounded, points, assumptions()).kind, 'unsupported');
  assert.equal(analyzeDividerBench(bench, { ...points, sourceGround: 'esp:GND' }, assumptions()).kind, 'unsupported');
});

test('a hypothetical analysis does not change bench safety or remove its interlock', () => {
  const bench = addWire({ ...fixture(), usb: true }, 'sonar:VCC', 'esp:5V', 'red');
  const before = structuredClone(bench);
  assert.equal(analyzeDividerBench(bench, points, assumptions()).kind, 'evaluated');
  assert.deepEqual(bench, before);
  assert.ok(blockingBoardPowerFault(bench, evaluateBench(bench)));
});

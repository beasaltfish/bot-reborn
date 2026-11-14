import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench } from '../../sim/bench.js';
import { findDividerTopology } from '../../sim/electrical/divider-topology.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { blockingBoardPowerFault } from '../../sim/board-power-gate.js';

function fixture() {
  let bench = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 30 }).bench;
  bench = addPart(addPart(bench, 'resistor', { x: 0, z: 0 }).bench, 'resistor', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['sonar:ECHO', 'r:1'], ['r:2', 'esp:GPIO4'], ['r2:1', 'esp:GPIO4'], ['r2:2', 'esp:GND'], ['sonar:GND', 'esp:GND']]) bench = addWire(bench, a, b, 'yellow');
  return bench;
}
const points = { source: 'sonar:ECHO', output: 'esp:GPIO4', ground: 'esp:GND' };

test('finds a unique two-resistor divider using actual nets', () => {
  const result = findDividerTopology(fixture(), points);
  assert.equal(result.kind, 'match');
  if (result.kind !== 'match') throw Error('not matched');
  assert.equal(result.upper, 'r');
  assert.equal(result.lower, 'r2');
  assert.deepEqual(result.points, ['esp:GND', 'esp:GPIO4', 'r2:1', 'r2:2', 'r:1', 'r:2', 'sonar:ECHO'].sort());
});

test('breadboard strip connections and reversed resistor orientation preserve the match', () => {
  let bench = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 30 }).bench;
  bench = addPart(addPart(bench, 'resistor', { x: 0, z: 0 }).bench, 'resistor', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['sonar:ECHO', 'r:2'], ['r:1', 'bb1:a1'], ['esp:GPIO4', 'bb1:b1'], ['r2:2', 'bb1:c1'], ['r2:1', 'esp:GND']]) bench = addWire(bench, a, b, 'yellow');
  const result = findDividerTopology(bench, points);
  assert.equal(result.kind, 'match');
  if (result.kind === 'match') assert.deepEqual([result.upper, result.lower], ['r', 'r2']);
});

test('branches, parallel parts, burnt resistors and shorted nodes are not recognized', () => {
  let branch = addPart(fixture(), 'led-5mm', { x: 0, z: 0 }).bench;
  branch = addWire(branch, 'led:A', 'esp:GPIO4', 'yellow');
  assert.equal(findDividerTopology(branch, points).kind, 'unsupported');
  let parallel = addPart(fixture(), 'resistor', { x: 0, z: 0 }).bench;
  parallel = addWire(addWire(parallel, 'r3:1', 'sonar:ECHO', 'red'), 'r3:2', 'esp:GPIO4', 'yellow');
  assert.equal(findDividerTopology(parallel, points).kind, 'unsupported');
  const original = fixture();
  const burnt = { ...original, placed: original.placed.map(part => part.id === 'r' ? { ...part, burnt: true } : part) };
  assert.equal(findDividerTopology(burnt, points).kind, 'unsupported');
  assert.equal(findDividerTopology(addWire(fixture(), 'sonar:ECHO', 'esp:GPIO4', 'red'), points).kind, 'unsupported');
  assert.equal(findDividerTopology(addWire(fixture(), 'esp:GPIO4', 'bb1:not-a-hole', 'red'), points).kind, 'unsupported');
  assert.equal(findDividerTopology(addWire(fixture(), 'esp:GND', 'esp:3V3', 'red'), points).kind, 'unsupported');
  assert.equal(findDividerTopology(addWire(fixture(), 'esp:GND', 'sonar:GND.2', 'black'), points).kind, 'unsupported');
});

test('identifying a divider never overrides the existing power interlock', () => {
  const bench = addWire({ ...fixture(), usb: true }, 'sonar:VCC', 'esp:5V', 'red');
  assert.equal(findDividerTopology(bench, points).kind, 'match');
  const result = evaluateBench(bench);
  assert.ok(result.faults.some(fault => fault.code === 'unsupported-electrical-network' && fault.points.includes('sonar:ECHO')));
  assert.ok(blockingBoardPowerFault(bench, result));
});

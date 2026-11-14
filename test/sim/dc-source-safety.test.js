import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addPart, addWire, setPartProperty } from '../../sim/bench.js';
import { evaluateBench } from '../../sim/devices/evaluate.js';
import { rankedDiagnoses } from '../../sim/ranked-diagnoses.js';

function sources() {
  let b = emptyBench();
  b = addPart(b, 'dc-source', { x: 0, z: 0 }).bench;
  return addPart(b, 'dc-source', { x: 0, z: 0 }).bench;
}

test('parallel independent sources report contention even without USB', () => {
  let b = sources();
  b = addWire(b, 'src:+', 'src2:+', 'red');
  b = addWire(b, 'src:-', 'src2:-', 'black');
  const result = evaluateBench(b);
  const fault = result.faults.find(f => f.code === 'source-contention');
  assert.ok(fault);
  assert.deepEqual(fault.instances, ['src', 'src2']);
  assert.deepEqual(new Set(fault.points), new Set(['src:+', 'src:-', 'src2:+', 'src2:-']));
  assert.match(rankedDiagnoses(b, result, 'zh')[0].text, /多个电源/);
});

test('opposing independent sources are reported as contention', () => {
  let b = sources();
  b = addWire(b, 'src:+', 'src2:-', 'red');
  b = addWire(b, 'src:-', 'src2:+', 'black');
  assert.ok(evaluateBench(b).faults.some(f => f.code === 'source-contention'));
});

test('a directly shorted independent source is diagnosed, while unrelated sources are not', () => {
  const separate = sources();
  assert.ok(!evaluateBench(separate).faults.some(f => ['source-short', 'source-contention'].includes(f.code)));
  const shorted = addWire(separate, 'src:+', 'src:-', 'red');
  const result = evaluateBench(shorted);
  const fault = result.faults.find(f => f.code === 'source-short');
  assert.ok(fault);
  assert.deepEqual(fault.points, ['src:+', 'src:-']);
  assert.match(rankedDiagnoses(shorted, result, 'en')[0].text, /short/i);
});

test('an independent supply connected to an unpowered ESP32 is explicitly unsupported', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'esp:5V', 'red');
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  const result = evaluateBench(bench);
  assert.equal(result.legacy.esp, 'off');
  const fault = result.faults.find(f => f.code === 'unsupported-electrical-network' && f.instances.includes('src') && f.instances.includes('esp'));
  assert.ok(fault);
  assert.deepEqual(new Set(fault.points), new Set(['src:+', 'src:-', 'esp:5V', 'esp:GND']));
  assert.ok(!result.faults.some(f => f.code === 'source-contention'));
});

test('an independent source connected to a powered ESP32 rail reports contention', () => {
  for (const rail of ['3V3', '5V']) for (const reversed of [false, true]) {
    let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
    bench = addWire(bench, 'src:+', reversed ? 'esp:GND' : `esp:${rail}`, 'red');
    bench = addWire(bench, 'src:-', reversed ? `esp:${rail}` : 'esp:GND', 'black');
    const result = evaluateBench(bench);
    const fault = result.faults.find(f => f.code === 'source-contention' && f.instances.includes('esp') && f.instances.includes('src'));
    assert.ok(fault, `${rail}, reversed=${reversed}`);
    assert.deepEqual(new Set(fault.points), new Set(['src:+', 'src:-', `esp:${rail}`, 'esp:GND']));
  }
});

test('a shared ground alone does not imply supply contention', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'source-contention'));
});

test('an external source above nominal GPIO logic voltage reports a risk without burning the board', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addWire(bench, 'src:+', 'esp:GPIO4', 'red');
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  const result = evaluateBench(bench);
  const fault = result.faults.find(f => f.code === 'gpio-overvoltage-risk');
  assert.ok(fault);
  assert.deepEqual(new Set(fault.points), new Set(['src:+', 'src:-', 'esp:GPIO4', 'esp:GND']));
  assert.ok(!result.burns.includes('esp'));
  assert.match(rankedDiagnoses(bench, result, 'zh').find(h => /GPIO/.test(h.text))?.text ?? '', /可能/);
  bench = setPartProperty(bench, 'src', 'voltage', 3.3);
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'gpio-overvoltage-risk'));
  assert.ok(evaluateBench(bench).faults.some(f => f.code === 'gpio-drive-unmodeled'));
});

test('a negative external source on GPIO is flagged as a risk', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'esp:GND', 'red');
  bench = addWire(bench, 'src:-', 'esp:GPIO4', 'black');
  assert.ok(evaluateBench(bench).faults.some(f => f.code === 'gpio-negative-voltage-risk'));
  bench = setPartProperty(bench, 'src', 'voltage', 0);
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'gpio-negative-voltage-risk'));
});

test('an external GPIO signal without common ground is explicitly diagnosed', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'esp:GPIO4', 'red');
  assert.ok(evaluateBench(bench).faults.some(f => f.code === 'source-ground-missing'));
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'source-ground-missing'));
});

test('a GPIO source referenced to an ESP32 supply rail is unsupported, not treated as floating', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'esp:GPIO4', 'red');
  bench = addWire(bench, 'src:-', 'esp:3V3', 'black');
  const result = evaluateBench(bench);
  assert.ok(result.faults.some(f => f.code === 'unsupported-electrical-network' && f.instances.includes('src')));
  assert.ok(!result.faults.some(f => f.code === 'source-ground-missing'));
});

test('a grounded source connected to GPIO through a resistor is unsupported, without guessing voltage', () => {
  let bench = { ...addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench, usb: true };
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'esp:GPIO4', 'yellow');
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  const result = evaluateBench(bench);
  const fault = result.faults.find(f => f.code === 'unsupported-electrical-network' && f.instances.includes('esp') && f.instances.includes('src'));
  assert.ok(fault);
  for (const point of ['src:+', 'src:-', 'r:1', 'r:2', 'esp:GPIO4', 'esp:GND']) assert.ok(fault.points.includes(point), point);
  assert.ok(!result.faults.some(f => f.code === 'gpio-overvoltage-risk'));
  assert.ok(!result.burns.includes('esp'));
});

test('a multi-resistor path through breadboard strips is diagnosed', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  for (const [a, b] of [['src:+', 'r:1'], ['r:2', 'bb1:a1'], ['bb1:e1', 'r2:1'], ['r2:2', 'esp:GPIO4'], ['src:-', 'esp:GND']]) bench = addWire(bench, a, b, 'red');
  const fault = evaluateBench(bench).faults.find(f => f.code === 'unsupported-electrical-network' && f.instances.includes('esp') && f.instances.includes('src'));
  assert.ok(fault);
  for (const point of ['r:1', 'r:2', 'r2:1', 'r2:2', 'esp:GPIO4']) assert.ok(fault.points.includes(point), point);
});

test('a source feeding GPIO through a resistor without a common ground is diagnosed', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'esp:GPIO4', 'yellow');
  const fault = evaluateBench(bench).faults.find(f => f.code === 'source-ground-missing');
  assert.ok(fault);
  for (const point of ['src:+', 'src:-', 'r:1', 'r:2', 'esp:GPIO4', 'esp:GND']) assert.ok(fault.points.includes(point), point);
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'gpio-overvoltage-risk'));
});

test('a resistor in the source ground reference is unsupported rather than reported floating', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'esp:GPIO4', 'red');
  bench = addWire(bench, 'src:-', 'r:1', 'black');
  bench = addWire(bench, 'r:2', 'esp:GND', 'black');
  const result = evaluateBench(bench);
  const fault = result.faults.find(f => f.code === 'unsupported-electrical-network' && f.instances.includes('src'));
  assert.ok(fault);
  assert.ok(fault.points.includes('r:1') && fault.points.includes('r:2'));
  assert.ok(!result.faults.some(f => f.code === 'source-ground-missing'));
});

test('a burnt resistor on an external source path is not assumed to be an open circuit', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = { ...bench, placed: bench.placed.map(part => part.id === 'r' ? { ...part, burnt: true } : part) };
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'esp:GPIO4', 'yellow');
  const fault = evaluateBench(bench).faults.find(item => item.code === 'unsupported-electrical-network' && item.points.includes('r:1'));
  assert.ok(fault);
  assert.ok(fault.points.includes('r:2') && fault.points.includes('esp:GPIO4'));
});

test('a grounded source connected to an ESP32 rail through a resistor is unsupported', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:+', 'r:1', 'red');
  bench = addWire(bench, 'r:2', 'esp:5V', 'yellow');
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  const fault = evaluateBench(bench).faults.find(f => f.code === 'unsupported-electrical-network' && f.instances.includes('esp') && f.instances.includes('src'));
  assert.ok(fault);
  assert.ok(fault.points.includes('r:1') && fault.points.includes('r:2'));
});

test('an isolated source and a GPIO pull-down do not form a modeled source path', () => {
  let bench = addPart(emptyBench(), 'dc-source', { x: 0, z: 0 }).bench;
  bench = addPart(bench, 'resistor', { x: 0, z: 0 }).bench;
  bench = addWire(bench, 'src:-', 'esp:GND', 'black');
  bench = addWire(bench, 'r:1', 'esp:GND', 'black');
  bench = addWire(bench, 'r:2', 'esp:GPIO4', 'yellow');
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'unsupported-electrical-network'));
});

test('sources sharing only one terminal are not diagnosed as parallel', () => {
  const bench = addWire(sources(), 'src:+', 'src2:+', 'red');
  assert.ok(!evaluateBench(bench).faults.some(f => f.code === 'source-contention'));
});

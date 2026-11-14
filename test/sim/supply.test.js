import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire } from '../../sim/bench.js';
import { evaluateElectrical } from '../../sim/electrical/evaluate.js';

const source = { kind: 'source', positive: '3V3', negative: 'GND', voltage: 5, currentLimitMa: 1000, internalResistanceOhm: 1 };
const load = { kind: 'supply', positive: 'VDD', ground: 'GND', currentsMa: { idle: 100, startup: 800 }, minVoltage: 4.5, maxVoltage: 6 };
const fixtures = { esp32: { capabilities: [source] }, inmp441: { capabilities: [load] } };
function circuit(reverse = false) {
  let b = emptyBench();
  b = addWire(b, 'esp:3V3', reverse ? 'mic:GND' : 'mic:VDD', 'red');
  return addWire(b, 'esp:GND', reverse ? 'mic:VDD' : 'mic:GND', 'black');
}
/** @param {import('../../sim/bench.js').Bench} b @param {Record<string, import('../../sim/electrical/supply.js').ElectricalDevice>} devices @param {import('../../sim/electrical/supply.js').OperatingMode} mode */
function run(b, devices = fixtures, mode = 'idle') { return evaluateElectrical(b, { profile: {}, mode, devices }); }
/** @param {import('../../sim/electrical/supply.js').ElectricalOutcome} o */
function rail(o) { return Object.values(o.rails).find(r => r.sourceInstances.includes('esp')); }
test('source voltage reflects load current and internal resistance', () => {
  const o = run(circuit()); const r = rail(o);
  assert.ok(r); assert.ok(r.voltage > 4.89 && r.voltage < 4.91); assert.equal(r.requestedCurrentMa, 100); assert.equal(r.status, 'ok');
});
test('source current is limited', () => {
  const o = run(circuit(), { ...fixtures, esp32: { capabilities: [{ ...source, currentLimitMa: 50 }] } });
  assert.equal(rail(o)?.deliveredCurrentMa, 50); assert.ok(o.faults.some(f => f.code === 'source-current-limit'));
});
test('reversed load polarity is reported', () => { assert.ok(run(circuit(true)).faults.some(f => f.code === 'reverse-polarity')); });
test('startup current can brown out a valid idle rail', () => {
  assert.ok(!run(circuit()).faults.some(f => f.code === 'rail-brownout'));
  const o = run(circuit(), fixtures, 'startup'); assert.ok((rail(o)?.voltage ?? 0) < 4.5); assert.ok(o.faults.some(f => f.code === 'rail-brownout'));
});
test('unequal sources on one net contend', () => {
  let b = addWire(circuit(), 'amp:Vin', 'esp:3V3', 'red'); b = addWire(b, 'amp:GND', 'esp:GND', 'black');
  const o = run(b, { ...fixtures, max98357a: { capabilities: [{ ...source, positive: 'Vin', negative: 'GND', voltage: 3.3 }] } });
  assert.equal(rail(o)?.status, 'contended'); assert.ok(o.faults.some(f => f.code === 'source-contention'));
});
test('regulator output drops when input lacks headroom', () => {
  let b = addWire(emptyBench(), 'esp:3V3', 'amp:Vin', 'red'); b = addWire(b, 'esp:GND', 'amp:GND', 'black');
  b = addWire(b, 'amp:DIN', 'mic:VDD', 'red'); b = addWire(b, 'amp:GND', 'mic:GND', 'black');
  const o = run(b, { esp32: { capabilities: [{ ...source, voltage: 3.5, internalResistanceOhm: 0 }] }, max98357a: { capabilities: [{ kind: 'regulator', input: 'Vin', output: 'DIN', ground: 'GND', voltage: 3.3, dropoutVoltage: 0.5, efficiency: 1, currentLimitMa: 500 }] }, inmp441: { capabilities: [{ ...load, minVoltage: 2.5 }] } });
  const r = Object.values(o.rails).find(x => x.sourceInstances.includes('amp')); assert.ok(r); assert.ok(r.voltage > 2.99 && r.voltage < 3.01); assert.equal(r.status, 'dropout');
});
test('a current-limited rail does not report a load as powered', () => {
  const o = run(circuit(), { ...fixtures, esp32: { capabilities: [{ ...source, currentLimitMa: 50 }] } });
  assert.equal(rail(o)?.status, 'limited'); assert.equal(rail(o)?.voltage, 0);
  assert.notEqual(o.devices.mic.status, 'ok'); assert.equal(o.devices.mic.currentMa, 0);
  assert.ok(o.faults.some(f => f.code === 'rail-brownout'));
});
test('unsupported numeric analogue model is reported', () => {
  const o = run(circuit(), { ...fixtures, max98357a: { capabilities: [{ kind: 'resistor', positive: 'Vin', negative: 'GND', resistanceOhm: 100 }] } });
  assert.ok(o.faults.some(f => f.code === 'unsupported-electrical-network'));
});
test('current limit remains visible when resistance would bring voltage to zero', () => {
  const o = run(circuit(), { ...fixtures, esp32: { capabilities: [{ ...source, internalResistanceOhm: 100, currentLimitMa: 50 }] } });
  assert.equal(rail(o)?.status, 'limited'); assert.ok(o.faults.some(f => f.code === 'rail-brownout'));
});
test('multiple loads on one device retain the worst status and total current', () => {
  const o = run(circuit(), { ...fixtures, inmp441: { capabilities: [{ ...load, maxVoltage: 4 }, { ...load, currentsMa: { idle: 20 } }] } });
  assert.equal(o.devices.mic.status, 'overvoltage'); assert.equal(o.devices.mic.currentMa, 120); assert.deepEqual(o.burns, ['mic']);
});
test('zero-output regulator reports dropout', () => {
  let b = addWire(emptyBench(), 'esp:3V3', 'amp:Vin', 'red'); b = addWire(b, 'esp:GND', 'amp:GND', 'black');
  const o = run(b, { esp32: { capabilities: [{ ...source, voltage: 0.2 }] }, max98357a: { capabilities: [{ kind: 'regulator', input: 'Vin', output: 'DIN', ground: 'GND', voltage: 3.3, dropoutVoltage: 0.5, efficiency: 1, currentLimitMa: 500 }] } });
  assert.ok(o.faults.some(f => f.code === 'regulator-dropout'));
});
test('source and load numeric fields resolve instance properties and profile rails', () => {
  const b = circuit(); b.placed[0].properties.v = 4; b.placed[1].properties.draw = 200;
  const devices = { esp32: { capabilities: [{ ...source, voltage: { property: 'v' } }] }, inmp441: { capabilities: [{ ...load, currentsMa: { idle: { property: 'draw' } } }] } };
  assert.ok(Math.abs((rail(run(b, devices))?.voltage ?? 0) - 3.8) < 0.001);
  const o = evaluateElectrical(b, { profile: { rails: { MAIN: 6 } }, mode: 'idle', devices: { ...devices, esp32: { capabilities: [{ ...source, voltage: { profileRail: 'MAIN' } }] } } });
  assert.ok(Math.abs((rail(o)?.voltage ?? 0) - 5.8) < 0.001);
});
test('regulator chain demand uses available voltages at each stage', () => {
  let b = addWire(emptyBench(), 'esp:3V3', 'amp:Vin', 'red'); b = addWire(b, 'esp:GND', 'amp:GND', 'black');
  b = addWire(b, 'amp:DIN', 'spk:+', 'red'); b = addWire(b, 'esp:GND', 'spk:-', 'black');
  b = addWire(b, 'spk:OUT', 'mic:VDD', 'red'); b = addWire(b, 'esp:GND', 'mic:GND', 'black');
  /** @param {string} input @param {string} output @param {string} ground @param {number} voltage */
  const regulator = (input, output, ground, voltage) => ({ kind: 'regulator', input, output, ground, voltage, dropoutVoltage: 0.5, efficiency: 1, currentLimitMa: 1000 });
  const o = run(b, { esp32: { capabilities: [{ ...source, voltage: 2, internalResistanceOhm: 0, currentLimitMa: 47 }] }, max98357a: { capabilities: [regulator('Vin', 'DIN', 'GND', 5)] }, speaker: { capabilities: [regulator('+', 'OUT', '-', 3)] }, inmp441: { capabilities: [{ ...load, minVoltage: 0.5 }] } });
  assert.equal(rail(o)?.status, 'limited'); assert.ok((rail(o)?.requestedCurrentMa ?? 0) >= 50); assert.notEqual(o.devices.mic.status, 'ok');
});
test('unsupported disconnected network leaves an independent rail working', () => {
  const o = run(circuit(), { ...fixtures, max98357a: { capabilities: [{ kind: 'resistor', positive: 'Vin', negative: 'GND', resistanceOhm: 100 }] } });
  assert.equal(rail(o)?.status, 'ok');
  assert.equal(o.devices.mic.status, 'ok');
  const dangerous = run(circuit(), { ...fixtures, inmp441: { capabilities: [{ ...load, maxVoltage: 4 }] }, max98357a: { capabilities: [{ kind: 'resistor', positive: 'Vin', negative: 'GND', resistanceOhm: 100 }] } });
  assert.equal(dangerous.devices.mic.status, 'overvoltage');
  assert.ok(dangerous.burns.includes('mic'));
});
test('missing numeric references are unsupported', () => {
  for (const override of [{ currentsMa: { idle: { property: 'missing' } } }, { maxVoltage: { profileRail: 'missing' } }]) {
    const o = run(circuit(), { ...fixtures, inmp441: { capabilities: [{ ...load, ...override }] } });
    assert.ok(o.faults.some(f => f.code === 'unsupported-electrical-network')); assert.equal(rail(o)?.status, 'off');
  }
});
test('unspecified operating mode falls back to idle current', () => {
  assert.equal(rail(run(circuit(), fixtures, 'peak'))?.requestedCurrentMa, 100);
});
test('placed order does not alter a simple rail outcome', () => {
  const b = circuit(); assert.deepEqual(run(b), run({ ...b, placed: [...b.placed].reverse() }));
});
test('regulator cycles are unsupported and unavailable', () => {
  let b = addWire(emptyBench(), 'amp:DIN', 'spk:+', 'red'); b = addWire(b, 'spk:OUT', 'amp:Vin', 'red'); b = addWire(b, 'amp:GND', 'spk:-', 'black');
  /** @param {string} input @param {string} output @param {string} ground */
  const reg = (input, output, ground) => ({ kind: 'regulator', input, output, ground, voltage: 3, dropoutVoltage: 0.2, efficiency: 1, currentLimitMa: 100 });
  const o = run(b, { max98357a: { capabilities: [reg('Vin', 'DIN', 'GND')] }, speaker: { capabilities: [reg('+', 'OUT', '-')] } });
  assert.deepEqual(o.faults.find(f => f.code === 'unsupported-electrical-network')?.instances, ['amp', 'spk']);
  assert.ok(Object.values(o.rails).every(r => r.status === 'off'));
});

test('unsupported source disables its downstream load', () => {
  const b = circuit();
  const o = run(b, { ...fixtures, esp32: { capabilities: [{ ...source, voltage: { property: 'missing' } }] } });
  assert.ok(o.faults.some(f => f.code === 'unsupported-electrical-network'));
  assert.notEqual(o.devices.mic.status, 'ok');
});

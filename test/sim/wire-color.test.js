import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire, setWireColor, serialize, load } from '../../sim/bench.js';
import { WIRE_PALETTE, recommendedWireColor, wireColor } from '../../sim/wire-color.js';
import { powerOn } from '../../sim/power.js';
import { diagnose } from '../../sim/diagnose.js';
import { TARGET } from '../../sim/target.js';

test('automatic wire colours preserve power, ground and signal rotation', () => {
  const b = emptyBench();
  assert.equal(recommendedWireColor(b, 'esp:3V3', 'mic:VDD'), '#d23a2e');
  assert.equal(recommendedWireColor(b, 'esp:GND', 'mic:GND'), '#1d1d1f');
  assert.equal(recommendedWireColor(b, 'esp:GPIO1', 'mic:SD'), '#f2c230');
  const next = addWire(b, 'esp:GPIO1', 'mic:SD', '#f2c230');
  assert.equal(recommendedWireColor(next, 'esp:GPIO2', 'mic:WS'), '#2e9e57');
  assert.equal(wireColor, recommendedWireColor);
});

test('recolouring a faulty wire preserves diagnosis identity', () => {
  let bench = { ...emptyBench(), usb: true };
  for (const link of TARGET.filter(link => link.a !== 'mic:VDD')) bench = addWire(bench, link.a, link.b, '#d23a2e');
  bench = addWire(bench, 'mic:VDD', 'esp:5V', '#d23a2e');
  const faulty = bench.wires.at(-1);
  assert.ok(faulty);
  const before = diagnose(bench, powerOn(bench)).filter(h => h.kind === 'fault');
  assert.ok(before.length > 0);
  const recolored = setWireColor(bench, faulty.id, '#2f6fd0');
  assert.deepEqual(diagnose(recolored, powerOn(recolored)).filter(h => h.kind === 'fault'), before);
  assert.equal(recolored.wires.at(-1)?.color, '#2f6fd0');
});

test('every manual palette colour survives bench serialization', () => {
  const b = addWire(emptyBench(), 'esp:3V3', 'mic:VDD', '#d23a2e');
  assert.deepEqual(WIRE_PALETTE.map(s => s.id), ['auto', 'red', 'black', 'yellow', 'green', 'blue', 'orange', 'white', 'purple']);
  assert.equal(WIRE_PALETTE[0].color, null);
  for (const swatch of WIRE_PALETTE.slice(1)) {
    assert.ok(swatch.color);
    assert.equal(load(serialize(setWireColor(b, b.wires[0].id, swatch.color))).wires[0].color, swatch.color);
  }
});

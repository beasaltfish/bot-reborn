import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS } from '../../sim/parts.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { addPart, emptyBench, load, serialize } from '../../sim/bench.js';
import { catalogueEntry } from '../../sim/ui/catalogue-model.js';
import { pinDescription } from '../../sim/pin-info.js';

test('HC-SR04 describes the selected 5 V module and keeps simulation support separate', () => {
  const part = PARTS['hc-sr04'];
  assert.deepEqual(part.pins.map(pin => pin.name), ['VCC', 'TRIG', 'ECHO', 'GND']);
  assert.deepEqual(part.pins.map(pin => pin.x), [0, 1, 2, 3]);
  assert.deepEqual(part.size, { w: 45, d: 20, h: 15 });
  const device = DEVICES['hc-sr04'];
  assert.ok(device.capabilities.some(cap => cap.kind === 'supply' && cap.positive === 'VCC' && cap.ground === 'GND'));
  assert.deepEqual(device.firmware.telemetry, ['distanceCm']);
  assert.equal(catalogueEntry('hc-sr04')?.simulated, false);
  assert.equal(catalogueEntry('hc-sr04')?.firmwareSupported, false);
  assert.match(catalogueEntry('hc-sr04', 'zh')?.summary ?? '', /开发中/);
  assert.match(pinDescription('hc-sr04', part.pins[2], 'en'), /5 V.*3\.3 V/);
  assert.match(pinDescription('hc-sr04', part.pins[2], 'zh'), /5 V.*3\.3 V/);
});

test('HC-SR04 survives bench serialization without adding simulated distance to wiring', () => {
  const bench = addPart(emptyBench(), 'hc-sr04', { x: 0, z: 30 }).bench;
  const restored = load(serialize(bench));
  assert.deepEqual(restored.placed.find(part => part.part === 'hc-sr04')?.properties, {});
});

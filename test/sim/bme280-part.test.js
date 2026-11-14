import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS } from '../../sim/parts.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { addPart, emptyBench, load, serialize, setPartProperty } from '../../sim/bench.js';
import { catalogueEntry } from '../../sim/ui/catalogue-model.js';

test('BME280 breakout uses the real seven-pin header and selectable address', () => {
  const part = PARTS['bme280-i2c'];
  assert.deepEqual(part.pins.map(p => p.name), ['VIN', '3Vo', 'GND', 'SCK', 'SDO', 'SDI', 'CS']);
  assert.deepEqual(part.pins.map(p => p.x), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(part.size, { w: 25.2, d: 18, h: 4.6 });
  assert.equal(part.onBoard, true);
  const device = DEVICES['bme280-i2c'];
  assert.deepEqual(device.properties.address, { kind: 'enum', default: '0x77', values: ['0x76', '0x77'] });
  assert.ok(device.capabilities.some(c => c.kind === 'i2c' && c.sda === 'SDI' && c.scl === 'SCK'));
  assert.deepEqual(device.firmware.telemetry, ['temperatureC', 'humidityPct', 'pressureHpa']);
  assert.equal(catalogueEntry(part.id)?.firmwareSupported, false);
  assert.equal(catalogueEntry(part.id)?.simulated, false);
});

test('the address jumper persists independently for each placed BME280', () => {
  let bench = addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 30 }).bench;
  bench = addPart(bench, 'bme280-i2c', { x: 10, z: 30 }).bench;
  bench = setPartProperty(bench, 'env2', 'address', '0x76');
  const restored = load(serialize(bench));
  assert.equal(restored.placed.find(p => p.id === 'env')?.properties.address, '0x77');
  assert.equal(restored.placed.find(p => p.id === 'env2')?.properties.address, '0x76');
});

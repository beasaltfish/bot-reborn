import test from 'node:test';
import assert from 'node:assert/strict';
import { addPart, addWire, emptyBench, setPartProperty } from '../../sim/bench.js';
import { bme280Wiring } from '../../sim/devices/bme280-wiring.js';

function sensor() { return addPart(emptyBench(), 'bme280-i2c', { x: 0, z: 30 }).bench; }

test('the address follows the modeled jumper and a grounded SDO', () => {
  const bench = sensor();
  assert.deepEqual(bme280Wiring(bench, 'env'), { address: 0x77, supported: true, points: [] });
  const jumper = setPartProperty(bench, 'env', 'address', '0x76');
  assert.equal(bme280Wiring(jumper, 'env').address, 0x76);
  const grounded = addWire(bench, 'env:SDO', 'env:GND', 'black');
  assert.deepEqual(bme280Wiring(grounded, 'env'), { address: 0x76, supported: true, points: [] });
  const sharedGround = addWire(grounded, 'env:GND', 'esp:GND', 'black');
  assert.deepEqual(bme280Wiring(sharedGround, 'env'), { address: 0x76, supported: true, points: [] });
});

test('unsupported SDO and CS connections are not guessed', () => {
  const bench = sensor();
  const driven = addWire(bench, 'env:SDO', 'esp:GPIO4', 'yellow');
  assert.deepEqual(bme280Wiring(driven, 'env'), { address: null, supported: false, points: ['env:SDO', 'esp:GPIO4'] });
  const chipSelect = addWire(bench, 'env:CS', 'esp:GND', 'black');
  const result = bme280Wiring(chipSelect, 'env');
  assert.equal(result.address, null);
  assert.equal(result.supported, false);
  assert.ok(result.points.includes('env:CS') && result.points.includes('esp:GND'));
});

test('a connection to an otherwise empty breadboard strip does not change the address', () => {
  const bench = addWire(sensor(), 'env:SDO', 'bb1:a1', 'yellow');
  assert.deepEqual(bme280Wiring(bench, 'env'), { address: 0x77, supported: true, points: [] });
  assert.throws(() => bme280Wiring(bench, 'missing'), RangeError);
});

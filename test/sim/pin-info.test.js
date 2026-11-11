import test from 'node:test';
import assert from 'node:assert/strict';
import { pinDescription } from '../../sim/pin-info.js';

test('pin descriptions distinguish shared names and screen roles', () => {
  assert.match(pinDescription('inmp441', { name: 'SD' }), /data output/);
  assert.match(pinDescription('max98357a', { name: 'SD' }), /shutdown/);
  assert.match(pinDescription('screen-test', { name: 'LED', role: 'BL' }), /backlight/);
  assert.match(pinDescription('mpu6050', { name: 'SDA' }), /I²C data/);
  assert.match(pinDescription('esp32', { name: 'GND.2' }), /ground/);
  assert.match(pinDescription('mpu6050', { name: 'SDA' }, 'zh'), /数据线/);
  assert.match(pinDescription('max98357a', { name: 'SD' }, 'zh'), /关断/);
});

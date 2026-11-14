import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench } from '../../sim/bench.js';
import { powerOn } from '../../sim/power.js';
import { diagnose } from '../../sim/diagnose.js';
import { liveDiagnosis } from '../../sim/live-diagnosis.js';
import { addWire } from '../../sim/bench.js';

const codes = ['unsupported-electrical-network', 'source-contention', 'source-short', 'led-reversed', 'led-overcurrent', 'led-burnt', 'led-current-limited', 'gpio-overvoltage-risk', 'gpio-negative-voltage-risk', 'gpio-drive-unmodeled', 'source-ground-missing', 'reverse-polarity', 'source-current-limit', 'regulator-dropout', 'rail-brownout', 'device-unpowered', 'device-overvoltage', 'device-overpower', 'firmware-unsupported', 'i2c-address-conflict', 'i2c-unpowered', 'i2c-controller-unpowered', 'i2c-supply-invalid', 'i2c-sda-scl-swapped', 'i2c-lines-shorted', 'i2c-line-on-rail', 'i2c-wrong-bus', 'i2c-level-incompatible', 'floating-input', 'gpio-contention', 'logic-level-incompatible', 'spi-chip-select-conflict', 'resource-pin-conflict', 'short-rails', 'mic-5v', 'mic-burnt', 'mic-unpowered', 'mic-right-slot', 'clocks-swapped', 'clock-missing', 'mic-data', 'amp-unpowered', 'amp-data', 'amp-shutdown', 'speaker', 'pins-shorted', 'bus-on-rail', 'mics-same-slot', 'screen-burnt', 'screen-5v', 'screen-unpowered', 'screen-needs-5v', 'screen-backlight', 'screen-spi-swapped', 'screen-signal', 'screen-cs', 'screens-mixed', 'screen-pins-shorted', 'screen-bus-on-rail', 'imu-burnt', 'imu-5v', 'imu-unpowered', 'imu-bus-swapped', 'imu-bus', 'imu-bus-short', 'bl-on-gpio', 'toy-burnt', 'toy-ungrounded', 'toy-ground-raised', 'toy-drive-missing', 'toy-steer-missing', 'toy-drive-swapped', 'toy-steer-swapped', 'toy-input-held', 'toy-input-contended', 'toy-pair-tied', 'toy-short'];

test('all known fault codes have Chinese explanations and unchanged English defaults', () => {
  const bench = emptyBench();
  const outcome = powerOn(bench);
  for (const code of codes) {
    const fault = { ...outcome, faults: [{ code, points: ['esp:3V3'] }] };
    const english = diagnose(bench, fault).find(hint => hint.kind === 'fault');
    const chinese = diagnose(bench, fault, 'zh').find(hint => hint.kind === 'fault');
    assert.ok(english && chinese, code);
    assert.match(chinese.text, /[\u3400-\u9fff]/, code);
    assert.doesNotMatch(english.text, /[\u3400-\u9fff]/, code);
    assert.deepEqual(chinese.points, english.points);
  }
});

test('powered-edit short diagnosis respects language and unknown faults remain visible', () => {
  const bench = { ...addWire(emptyBench(), 'esp:3V3', 'esp:GND', 'red'), usb: true };
  assert.match(liveDiagnosis(bench, 'zh')?.text ?? '', /短接/);
  const unknown = diagnose(bench, { ...powerOn(bench), faults: [{ code: 'future-code', points: [] }] }, 'zh').find(h => h.kind === 'fault');
  assert.match(unknown?.text ?? '', /future-code/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { bme280State } from '../../sim/devices/bme280.js';
import { defaultStimuli, setStimulus } from '../../sim/stimuli.js';

test('ready sensor reports the current environment independently of firmware support', () => {
  const stimuli = setStimulus(defaultStimuli(), 'temperatureC', 27);
  assert.deepEqual(bme280State('env', { states: { env: 'ready' }, firmwareSupported: false }, stimuli), {
    state: 'ready', telemetry: { temperatureC: 27, humidityPct: 50, pressureHpa: 1013.25 },
  });
});

test('unavailable and faulted sensors never return stale readings', () => {
  for (const state of ['off', 'address-conflict', 'swapped', 'shorted', 'wrong-bus', 'unsupported-voltage']) {
    assert.deepEqual(bme280State('env', { states: { env: state } }, defaultStimuli()), { state, telemetry: null });
  }
  assert.deepEqual(bme280State('missing', { states: {} }, defaultStimuli()), { state: 'off', telemetry: null });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBme280LabExample } from '../../sim/lessons/bme280-example.js';
import { defaultStimuli, setStimulus } from '../../sim/stimuli.js';

test('lab challenges use real shared bus diagnostics at either address', () => {
  const example = createBme280LabExample();
  example.setAddress('0x76');
  example.setScenario('swapped');
  assert.equal(example.evaluate(defaultStimuli()).state, 'swapped');
  example.setScenario('conflict');
  assert.equal(example.evaluate(defaultStimuli()).state, 'address-conflict');
  example.setScenario('normal');
  assert.equal(example.evaluate(defaultStimuli()).state, 'ready');
});

test('isolated BME lab example uses shared evaluation and preserves session stimulus separately', () => {
  const example = createBme280LabExample();
  const first = example.evaluate(defaultStimuli());
  assert.equal(first.state, 'ready');
  assert.equal(first.telemetry?.temperatureC, 22);
  const changed = example.evaluate(setStimulus(defaultStimuli(), 'temperatureC', 35));
  assert.equal(changed.telemetry?.temperatureC, 35);
  assert.equal(example.evaluate(defaultStimuli()).telemetry?.temperatureC, 22);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStimuli, setStimulus } from '../../sim/stimuli.js';

test('environment defaults are independent and updates are immutable', () => {
  const initial = defaultStimuli();
  assert.deepEqual(initial, { temperatureC: 22, humidityPct: 50, pressureHpa: 1013.25 });
  const updated = setStimulus(initial, 'temperatureC', 30);
  assert.equal(updated.temperatureC, 30);
  assert.equal(initial.temperatureC, 22);
  assert.notEqual(defaultStimuli(), initial);
});

test('environment values are bounded and invalid input leaves state unchanged', () => {
  let state = defaultStimuli();
  state = setStimulus(state, 'temperatureC', -100);
  state = setStimulus(state, 'humidityPct', 101);
  state = setStimulus(state, 'pressureHpa', 2000);
  assert.deepEqual(state, { temperatureC: -40, humidityPct: 100, pressureHpa: 1100 });
  for (const invalid of [NaN, Infinity, '12', null]) assert.equal(setStimulus(state, 'humidityPct', invalid), state);
  assert.equal(setStimulus(state, '__proto__', 2), state);
});

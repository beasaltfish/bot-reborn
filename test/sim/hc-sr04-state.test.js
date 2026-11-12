import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSonarStimuli, setSonarDistance, hcSr04State } from '../../sim/devices/hc-sr04.js';

const ready = /** @type {const} */ ({ power: 'on', trigger: 'valid', echo: 'compatible' });

test('distance stimulus is session-only, immutable, bounded and rejects invalid input', () => {
  const original = defaultSonarStimuli();
  assert.deepEqual(original, { distanceCm: 100 });
  assert.deepEqual(setSonarDistance(original, -3), { distanceCm: 2 });
  assert.deepEqual(setSonarDistance(original, 600), { distanceCm: 400 });
  assert.equal(setSonarDistance(original, NaN), original);
  assert.equal(setSonarDistance(original, '12'), original);
  assert.deepEqual(original, { distanceCm: 100 });
});

test('valid wiring is idle until explicit trigger, then produces bounded modeled measurement', () => {
  const stimuli = setSonarDistance(defaultSonarStimuli(), 25);
  assert.deepEqual(hcSr04State(ready, stimuli, 'idle'), { state: 'ready', distanceCm: null, echoDurationUs: null });
  assert.deepEqual(hcSr04State(ready, stimuli, 'measure'), { state: 'measured', distanceCm: 25, echoDurationUs: 1450 });
});

test('unpowered, swapped, incompatible and unverified circuits never return readings', () => {
  for (const [conditions, expected] of [
    [{ ...ready, power: 'off' }, 'off'],
    [{ ...ready, power: 'unknown' }, 'unsupported'],
    [{ ...ready, trigger: 'swapped' }, 'swapped'],
    [{ ...ready, trigger: 'unknown' }, 'unsupported'],
    [{ ...ready, echo: 'incompatible' }, 'incompatible'],
    [{ ...ready, echo: 'unknown' }, 'unsupported'],
  ]) {
    const result = hcSr04State(/** @type {import('../../sim/devices/hc-sr04.js').Conditions} */ (conditions), defaultSonarStimuli(), 'measure');
    assert.equal(result.state, expected);
    assert.equal(result.distanceCm, null);
    assert.equal(result.echoDurationUs, null);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { micConstraints } from '../web/audio/pipeline.js';

test('the two settings the wake word depends on are never negotiable', () => {
  const a = /** @type {MediaTrackConstraints} */ (micConstraints().audio);
  // autoGainControl would ride a quiet room's level up and make the noise
  // floor §5.8 cares about meaningless; noiseSuppression eats the same
  // consonant onsets the wake word is made of. No caller may turn these on.
  assert.equal(a.autoGainControl, false);
  assert.equal(a.noiseSuppression, false);
});

test('echoCancellation defaults to on — the product value is unchanged', () => {
  const a = /** @type {MediaTrackConstraints} */ (micConstraints().audio);
  assert.equal(a.echoCancellation, true);
});

test('echoCancellation can be turned off, which is what ⑥ measures', () => {
  const a = /** @type {MediaTrackConstraints} */
    (micConstraints({ echoCancellation: false }).audio);
  assert.equal(a.echoCancellation, false);
  // Turning AEC off must not disturb the other two.
  assert.equal(a.autoGainControl, false);
  assert.equal(a.noiseSuppression, false);
});

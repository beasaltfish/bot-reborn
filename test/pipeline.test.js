import test from 'node:test';
import assert from 'node:assert/strict';
import { micConstraints, gapFrames, reprocessTrack } from '../web/audio/pipeline.js';

test('autoGainControl is never negotiable', () => {
  // It would ride a quiet room's level up and make the noise floor §5.8 cares
  // about meaningless. No caller may turn this on, and unlike the other two it
  // has no measurement waiting on it.
  assert.equal(/** @type {MediaTrackConstraints} */ (micConstraints().audio).autoGainControl, false);
  assert.equal(/** @type {any} */ (micConstraints({ noiseSuppression: true }).audio).autoGainControl, false);
  assert.equal(/** @type {any} */ (micConstraints({ echoCancellation: false }).audio).autoGainControl, false);
});

test('noiseSuppression defaults to ON — reversed on 2026-09-17', () => {
  // This assertion twice said the opposite. It read "no caller may turn this
  // on" because the suppressor eats the wake word's consonant onsets, which is
  // still true and still measured. The trade was taken anyway: the cost falls
  // on a phoneme-matching spotter that is being replaced by a trained model,
  // and the benefit — no spurious VAD segments in a silent room — has nothing
  // else queued to deliver it. See micConstraints' comment for the full case.
  const a = /** @type {MediaTrackConstraints} */ (micConstraints().audio);
  assert.equal(a.noiseSuppression, true);
});

test('noiseSuppression can still be turned off, which is what ⑦ measures', () => {
  const a = /** @type {MediaTrackConstraints} */
    (micConstraints({ noiseSuppression: false }).audio);
  assert.equal(a.noiseSuppression, false);
  // Lowering it must not disturb the other two.
  assert.equal(a.autoGainControl, false);
  assert.equal(a.echoCancellation, true);
});

test('echoCancellation defaults to on — the product value is unchanged', () => {
  const a = /** @type {MediaTrackConstraints} */ (micConstraints().audio);
  assert.equal(a.echoCancellation, true);
});

test('echoCancellation can be turned off, which is what ⑥ measures', () => {
  const a = /** @type {MediaTrackConstraints} */
    (micConstraints({ echoCancellation: false }).audio);
  assert.equal(a.echoCancellation, false);
  // Turning AEC off must not disturb the other two — and since 2026-09-17 that
  // means noiseSuppression stays ON here. ⑥'s two runs differ in one setting.
  assert.equal(a.autoGainControl, false);
  assert.equal(a.noiseSuppression, true);
});

// --- switching the processing on a live track ------------------------------

test('gapFrames(): frames that arrived on time leave no hole', () => {
  assert.equal(gapFrames(10, 1000), 0);
});

test('gapFrames(): a stall shows up as the frames that never came', () => {
  // 1000 ms of wall clock owes 10 frames at FRAME_MS = 100. Six arrived, so
  // four 100 ms holes were punched somewhere in there — and B's whole risk is
  // this number, because the switch lands on the wake word's own transition.
  assert.equal(gapFrames(6, 1000), 4);
});

test('gapFrames(): never negative — early frames are jitter, not credit', () => {
  // The worklet can deliver a frame a hair early. That is not a negative hole,
  // and letting it read as one would let a real stall later be cancelled out.
  assert.equal(gapFrames(11, 1000), 0);
});

/** @param {boolean[]} reports what getSettings() answers, call by call */
function fakeTrack(reports, { throws = false } = {}) {
  let i = 0;
  return {
    /** @type {any[]} */ tried: [],
    /** @param {any} c */
    async applyConstraints(c) {
      this.tried.push(c);
      if (throws) throw new Error('OverconstrainedError');
    },
    getSettings: () => ({ noiseSuppression: reports[Math.min(i++, reports.length - 1)] }),
  };
}

test('reprocess(): the ideal form taking is the end of it', async () => {
  const track = fakeTrack([true]);
  const got = await reprocessTrack(/** @type {any} */ (track), { noiseSuppression: true });
  assert.equal(got.took, 'ideal');
  assert.equal(got.settings.noiseSuppression, true);
  assert.equal(track.tried.length, 1);
});

test('reprocess(): a silently ignored ideal form is retried as exact', async () => {
  // Chrome's measured behaviour on 2026-09-17: resolves, no error, getSettings
  // unmoved. `exact` is the form that must take or reject, so it is the one
  // that tells "will not" apart from "cannot".
  const track = fakeTrack([false, true]);
  const got = await reprocessTrack(/** @type {any} */ (track), { noiseSuppression: true });
  assert.equal(got.took, 'exact');
  assert.deepEqual(track.tried, [{ noiseSuppression: true }, { noiseSuppression: { exact: true } }]);
});

test('reprocess(): neither form taking reads as null, not as success', async () => {
  const track = fakeTrack([false, false]);
  const got = await reprocessTrack(/** @type {any} */ (track), { noiseSuppression: true });
  assert.equal(got.took, null);
  assert.equal(got.settings.noiseSuppression, false);
});

test('reprocess(): a rejected constraint is reported, not thrown', async () => {
  const track = fakeTrack([false, false], { throws: true });
  const got = await reprocessTrack(/** @type {any} */ (track), { noiseSuppression: true });
  assert.equal(got.error, 'OverconstrainedError');
  assert.equal(got.took, null);
});

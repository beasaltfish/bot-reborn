import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEPALIVE, BEHIND_FRAMES, expectedFrames, framesBehind, isBehind, shouldPlay,
} from '../web/audio/keepalive.js';

test('the sound is the shape §5.8 chose, not the one that failed', () => {
  // 60 Hz was the first attempt and the phone speaker could not produce it —
  // it came out as distortion. The trough stays at 30% because a trough that
  // reaches zero gets the tab judged silent once per cycle, which turns the
  // keep-alive intermittent. −40 dBFS is far above Chrome's silence threshold
  // (≈ −60) and far below audible across a room.
  assert.equal(KEEPALIVE.carrier, 220);
  assert.equal(KEEPALIVE.secs, 4);
  assert.equal(KEEPALIVE.dbfs, -40);
  assert.equal(KEEPALIVE.depth, 0.7);   // trough = 1 − 0.7 = 30%
});

test('expected frames come from the wall clock', () => {
  assert.equal(expectedFrames(1000), 10);
  assert.equal(expectedFrames(0), 0);
});

test('a pipeline that kept up is not reported as behind', () => {
  assert.equal(framesBehind(100, 10000), 0);
  assert.equal(isBehind(100, 10000), false);
  // Scheduling jitter is not a failure: §5.8's criterion is fed >= wall − 5.
  assert.equal(isBehind(96, 10000), false);
  assert.equal(isBehind(95, 10000), false);
});

test('a minute of silence while the screen was off IS reported', () => {
  // The android-took-the-mic failure: about 600 frames never arrive.
  assert.equal(isBehind(600, 120000), true);
  assert.equal(framesBehind(600, 120000), 600);
});

test('being ahead is never negative', () => {
  assert.equal(framesBehind(120, 10000), 0);
});

test('the threshold is the one number spec §5.8 states', () => {
  assert.equal(BEHIND_FRAMES, 5);
});

test('by default the tone follows §5.8: play when hidden, silent when not', () => {
  assert.equal(shouldPlay(true), true);
  assert.equal(shouldPlay(false), false);
});

test('always makes it play in both — the control group waiting item ⑫ needs', () => {
  // ⑤ proved "play the whole time" keeps the microphone. ⑫ asks whether the
  // gated version survives autoplay policy, and a comparison needs both arms.
  assert.equal(shouldPlay(true, true), true);
  assert.equal(shouldPlay(false, true), true);
});

test('always:false is the default, not a third state', () => {
  assert.equal(shouldPlay(false, false), false);
  assert.equal(shouldPlay(true, false), true);
});

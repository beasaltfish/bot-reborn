import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceFrames } from '../web/audio-bench/samples.js';

test('an exact multiple slices into whole frames and nothing else', () => {
  const frames = sliceFrames(new Float32Array(3200), 1600);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 1600);
  assert.equal(frames[1].length, 1600);
});

test('the samples arrive in order', () => {
  const input = new Float32Array([1, 2, 3, 4]);
  const frames = sliceFrames(input, 2);
  assert.deepEqual([...frames[0]], [1, 2]);
  assert.deepEqual([...frames[1]], [3, 4]);
});

test('a partial tail is zero-padded, not dropped', () => {
  // Dropping it would cost the end of every clip, and the "talk for longer
  // than bufferSeconds" step of ⑯ is specifically about what happens at the
  // end. Padding is safe: the VAD's endpoint needs 800 ms of silence
  // (vad.js minSilenceDuration), and this adds less than one frame.
  const frames = sliceFrames(new Float32Array([1, 2, 3]), 2);
  assert.equal(frames.length, 2);
  assert.deepEqual([...frames[1]], [3, 0]);
});

test('an empty input yields no frames at all', () => {
  assert.deepEqual(sliceFrames(new Float32Array(0), 1600), []);
});

test('an input shorter than one frame still yields one padded frame', () => {
  const frames = sliceFrames(new Float32Array([0.5]), 4);
  assert.equal(frames.length, 1);
  assert.deepEqual([...frames[0]], [0.5, 0, 0, 0]);
});

test('each frame is a copy — a caller mutating one cannot reach the source', () => {
  // The live path hands the VAD a buffer the worklet transferred, which nobody
  // else holds. Replay must not be the one place where two readers share.
  const input = new Float32Array([1, 2, 3, 4]);
  const frames = sliceFrames(input, 2);
  frames[0][0] = 99;
  assert.equal(input[0], 1);
});

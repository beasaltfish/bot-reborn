import test from 'node:test';
import assert from 'node:assert/strict';
import { toInt16, joinFrames } from '../web/audio/pcm.js';

test('full scale maps to the ends of the Int16 range', () => {
  assert.deepEqual([...toInt16(new Float32Array([0, 1, -1]))], [0, 32767, -32767]);
});

test('samples beyond full scale clip instead of wrapping', () => {
  // Without the clamp, 1.5 * 32767 overflows Int16 and comes out NEGATIVE — a
  // loud sample turns into inverted noise, which sounds like a broken mic
  // rather than like clipping, and gets diagnosed as one.
  assert.deepEqual([...toInt16(new Float32Array([1.5, -1.5]))], [32767, -32767]);
});

test('joinFrames concatenates in order and keeps the total length', () => {
  const out = joinFrames([new Float32Array([1, 2]), new Float32Array([3])]);
  assert.deepEqual([...out], [1, 2, 3]);
  assert.equal(joinFrames([]).length, 0);
});

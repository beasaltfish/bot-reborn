import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemotePipeline } from '../../server/body/pipeline.js';
import { int16ToBytes } from '../../server/audio/pcm.js';

const bytesOf = (/** @type {number} */ n, /** @type {number} */ value) =>
  int16ToBytes(new Int16Array(n).fill(value));

test('frames are re-cut to 100 ms whatever size the body sends', () => {
  const p = new RemotePipeline();
  /** @type {Float32Array[]} */ const got = [];
  p.subscribe('vad', (f) => got.push(f));
  p.feed(bytesOf(1000, 16384));
  assert.equal(got.length, 0);
  p.feed(bytesOf(700, 16384));
  assert.equal(got.length, 1);
  assert.equal(got[0].length, 1600);
  assert.equal(got[0][0], 0.5);
  p.feed(bytesOf(1500, 16384));
  assert.equal(got.length, 2);
});

test('every subscriber gets the frame; an unsubscribed one does not', () => {
  const p = new RemotePipeline();
  let kws = 0; let vad = 0;
  p.subscribe('kws', () => kws++);
  p.subscribe('vad', () => vad++);
  p.unsubscribe('vad');
  p.feed(bytesOf(1600, 0));
  assert.deepEqual([kws, vad], [1, 0]);
  assert.deepEqual(p.subscribers, ['kws']);
});

test('clear drops a half frame', () => {
  const p = new RemotePipeline();
  let n = 0;
  p.subscribe('kws', () => n++);
  p.feed(bytesOf(1000, 0));
  p.clear();
  p.feed(bytesOf(1000, 0));
  assert.equal(n, 0);
});

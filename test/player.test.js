import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmPlayer } from '../phone/audio/player.js';

function fakeCtx() {
  /** @type {Array<{ at: number, n: number, rate: number, first: number }>} */ const started = [];
  let stopped = 0;
  /** @type {any} */
  const ctx = {
    currentTime: 0,
    destination: {},
    /** @param {number} _ch @param {number} n @param {number} rate */
    createBuffer(_ch, n, rate) {
      const data = new Float32Array(n);
      return { length: n, sampleRate: rate, getChannelData: () => data };
    },
    createBufferSource() {
      /** @type {any} */
      const src = {
        buffer: null, onended: null,
        connect() {},
        /** @param {number} at */
        start(at) { started.push({ at, n: src.buffer.length, rate: src.buffer.sampleRate, first: src.buffer.getChannelData(0)[0] }); },
        stop() { stopped++; },
      };
      return src;
    },
  };
  return { ctx, started, get stopped() { return stopped; } };
}

/** @param {number[]} samples */
const pcm = (samples) => new Int16Array(samples).buffer;

test('chunks play back to back at 16 kHz, in the order they came', () => {
  const f = fakeCtx();
  const p = new PcmPlayer(f.ctx);
  p.play(pcm(new Array(1600).fill(0)));
  p.play(pcm(new Array(800).fill(0)));
  assert.deepEqual(f.started.map((s) => [s.at, s.n, s.rate]), [[0, 1600, 16000], [0.1, 800, 16000]]);
});

test('the samples are little-endian 16-bit, scaled to [-1, 1)', () => {
  const f = fakeCtx();
  new PcmPlayer(f.ctx).play(pcm([16384]));
  assert.equal(f.started[0].first, 0.5);
});

test('a queue that ran dry starts the next chunk now, not in the past', () => {
  const f = fakeCtx();
  const p = new PcmPlayer(f.ctx);
  p.play(pcm(new Array(1600).fill(0)));
  f.ctx.currentTime = 5;
  p.play(pcm(new Array(1600).fill(0)));
  assert.equal(f.started[1].at, 5);
});

test('hush stops everything queued, and what comes after plays from now', () => {
  const f = fakeCtx();
  const p = new PcmPlayer(f.ctx);
  p.play(pcm(new Array(16000).fill(0)));
  p.play(pcm(new Array(16000).fill(0)));
  f.ctx.currentTime = 0.2;
  p.hush();
  assert.equal(f.stopped, 2);
  p.play(pcm(new Array(1600).fill(0)));
  assert.equal(f.started[2].at, 0.2);
});

test('an empty frame plays nothing', () => {
  const f = fakeCtx();
  new PcmPlayer(f.ctx).play(new ArrayBuffer(0));
  assert.equal(f.started.length, 0);
});

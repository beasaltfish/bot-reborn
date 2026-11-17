import test from 'node:test';
import assert from 'node:assert/strict';

import { createBodyAudio } from '../../sim/body.js';
import { createBodyAudioLink } from '../../sim/firmware/audio-link.js';

/** The smallest AudioContext PcmPlayer will accept, so plays can be counted. */
function fakeContext() {
  const started = /** @type {number[]} */ ([]);
  return {
    started,
    state: 'running',
    currentTime: 0,
    destination: {},
    /** @param {number} _channels @param {number} n */
    createBuffer(_channels, n) { return { getChannelData: () => new Float32Array(n) }; },
    createBufferSource() {
      return {
        connect() {},
        /** @param {number} at */
        start(at) { started.push(at); },
        stop() {},
        onended: /** @type {null | (() => void)} */ (null),
      };
    },
  };
}

const PCM = /** @type {any} */ (Int16Array.from([0, 1000, -1000, 3000]).buffer);

test('a denied microphone still plays the downlink and keeps the link', async () => {
  const ctx = fakeContext();
  const levels = /** @type {[number, number][]} */ ([]);
  let blocked = 0;
  let sent = 0;
  const link = createBodyAudioLink({
    outcome: /** @type {any} */ ({ mic: 'ok', amp: 'ok' }),
    audio: /** @type {any} */ ({ get context() { return ctx; } }),
    acquire: /** @type {any} */ (async () => { throw new Error('denied'); }),
    onMicBlocked() { blocked += 1; },
    onLevel(/** @type {number} */ up, /** @type {number} */ down) { levels.push([up, down]); },
  });
  await link.attach(() => { sent += 1; });
  assert.equal(blocked, 1);
  assert.equal(sent, 0);
  link.downlink(PCM);
  assert.equal(ctx.started.length, 1);
  const last = levels.at(-1);
  assert.ok(last && last[1] > 0);
  link.stop();
});

test('no running output context asks for a gesture instead of ending the session', () => {
  /** @type {any} */ let ctx = null;
  let asked = 0;
  const link = createBodyAudioLink({
    outcome: /** @type {any} */ ({ mic: 'ok', amp: 'ok' }),
    audio: /** @type {any} */ ({ get context() { return ctx; } }),
    onNeedsGesture() { asked += 1; },
  });
  link.downlink(PCM);
  assert.equal(asked, 1);
  ctx = fakeContext();
  link.downlink(PCM);
  assert.equal(ctx.started.length, 1);
  assert.equal(asked, 1);
  link.stop();
});

test('a suspended context is not played into; the next gesture is', () => {
  const ctx = fakeContext();
  ctx.state = 'suspended';
  let asked = 0;
  const link = createBodyAudioLink({
    outcome: /** @type {any} */ ({ mic: 'ok', amp: 'ok' }),
    audio: /** @type {any} */ ({ get context() { return ctx; } }),
    onNeedsGesture() { asked += 1; },
  });
  link.downlink(PCM);
  assert.equal(ctx.started.length, 0);
  assert.equal(asked, 1);
  ctx.state = 'running';
  link.downlink(PCM);
  assert.equal(ctx.started.length, 1);
  link.stop();
});

test('stopping during microphone acquisition subscribes to nothing', async () => {
  /** @type {(value: any) => void} */ let resolve = () => {};
  let subscribed = 0;
  const link = createBodyAudioLink({
    outcome: /** @type {any} */ ({ mic: 'ok', amp: 'ok' }),
    audio: /** @type {any} */ ({ get context() { return null; } }),
    acquire: /** @type {any} */ (() => new Promise((r) => { resolve = r; })),
  });
  const starting = link.attach(() => {});
  link.stop();
  resolve({ pipeline: { subscribe() { subscribed += 1; }, unsubscribe() {} }, commit() {}, cancel() {} });
  await starting;
  assert.equal(subscribed, 0);
});

test('the output context resumes once and closes on power off', async () => {
  const calls = /** @type {string[]} */ ([]);
  const ctx = /** @type {any} */ ({ state: 'suspended', resume: async () => { calls.push('resume'); ctx.state = 'running'; }, close: () => { calls.push('close'); } });
  const audio = createBodyAudio(() => ctx);
  assert.equal(audio.context, null);
  await audio.resume();
  await audio.resume();
  assert.deepEqual(calls, ['resume']);
  audio.close();
  assert.deepEqual(calls, ['resume', 'close']);
  assert.equal(audio.context, null);
});

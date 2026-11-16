import test from 'node:test';
import assert from 'node:assert/strict';

import { startBody, createBodyAudio } from '../../sim/body.js';
import { powerOn } from '../../sim/power.js';
import { emptyBench } from '../../sim/bench.js';
import { AudioPipeline } from '../../phone/audio/pipeline.js';

test('a denied microphone still connects and keeps the session', async () => {
  const oldStart = AudioPipeline.start, oldSocket = globalThis.WebSocket, oldLocation = globalThis.location;
  try {
    let sockets = 0, blocked = 0, ends = 0;
    AudioPipeline.start = /** @type {any} */ (async () => { throw new Error('denied'); });
    globalThis.WebSocket = /** @type {any} */ (class { constructor() { sockets += 1; } send() {} close() {} });
    globalThis.location = /** @type {Location} */ (/** @type {unknown} */ ({ protocol: 'http:', host: 'localhost' }));
    const body = await startBody({
      token: 'a'.repeat(32), outcome: powerOn(emptyBench()), audioContext: /** @type {any} */ ({}),
      onMicBlocked() { blocked += 1; },
      onState() {}, onLevel() {}, onEnd() { ends += 1; },
    });
    assert.equal(sockets, 1);
    assert.equal(blocked, 1);
    assert.equal(ends, 0);
    body.stop();
  } finally { AudioPipeline.start = oldStart; globalThis.WebSocket = oldSocket; globalThis.location = oldLocation; }
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

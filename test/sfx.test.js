import test from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, createSfx } from '../web/audio/sfx.js';

test('exactly the four sounds of the reflex spec §5', () => {
  assert.deepEqual([...SOUNDS], ['bark', 'yip', 'whimper', 'growl']);
});

/** A context that decodes any bytes into a buffer of `secs` and records starts. */
function fakeCtx(secs = 0.4) {
  /** @type {number[]} */ const started = [];
  return {
    started,
    destination: {},
    decodeAudioData: async (/** @type {ArrayBuffer} */ _b) => ({ duration: secs }),
    createBufferSource() {
      const src = /** @type {any} */ ({
        buffer: null,
        connect() { return src; },
        start() { started.push(src.buffer.duration); },
      });
      return src;
    },
  };
}

test('load() fetches every sound and play() reports its length in ms', async () => {
  const ctx = fakeCtx(0.4);
  /** @type {string[]} */ const asked = [];
  const sfx = createSfx(/** @type {any} */ (ctx), {
    fetch: /** @type {any} */ (async (/** @type {string} */ url) => {
      asked.push(url);
      return new Response(new ArrayBuffer(8));
    }),
  });
  await sfx.load();
  assert.deepEqual(asked.sort(), SOUNDS.map((n) => `sounds/${n}.mp3`).sort());
  assert.equal(sfx.play('bark'), 400);
  assert.deepEqual(ctx.started, [0.4]);
});

test('a sound that failed to load plays as nothing and says 0 ms', async () => {
  // A 404 or a decode failure must not stop the movement queued behind it.
  const ctx = fakeCtx();
  const sfx = createSfx(/** @type {any} */ (ctx), {
    fetch: /** @type {any} */ (async (/** @type {string} */ url) => (url.includes('bark')
      ? new Response('', { status: 404 })
      : new Response(new ArrayBuffer(8)))),
  });
  await sfx.load();
  assert.equal(sfx.play('bark'), 0);
  assert.deepEqual(ctx.started, []);
});

test('load() survives a fetch that throws', async () => {
  const sfx = createSfx(/** @type {any} */ (fakeCtx()), {
    fetch: async () => { throw new Error('offline'); },
  });
  await sfx.load();
  assert.equal(sfx.play('yip'), 0);
});

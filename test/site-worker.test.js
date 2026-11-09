import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../site/worker.js';

/** A stand-in for the ASSETS binding: one 100-byte file that ignores Range, like the real one. */
function env(bytes = 100) {
  const body = new Uint8Array(Array.from({ length: bytes }, (_, i) => i % 256));
  return {
    ASSETS: {
      /** @param {Request} req */
      async fetch(req) {
        if (new URL(req.url).pathname !== '/media/hero.mp4') return new Response('nope', { status: 404 });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes) } });
      },
    },
  };
}

/** @param {string} range @param {number} [size] */
const ask = (range, size) => worker.fetch(
  new Request('https://bot-reborn.agentlenshq.com/media/hero.mp4', { headers: range ? { Range: range } : {} }),
  /** @type {any} */ (env(size)),
);

test('a request without Range is passed straight through', async () => {
  const res = await ask('');
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test('bytes=0-9 is a 206 with exactly those ten bytes', async () => {
  const res = await ask('bytes=0-9');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-9/100');
  assert.equal(res.headers.get('content-length'), '10');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  const body = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...body], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('an open-ended range runs to the last byte', async () => {
  const res = await ask('bytes=90-');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 90-99/100');
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test('a suffix range counts back from the end', async () => {
  const res = await ask('bytes=-10');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 90-99/100');
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test('a range past the end is 416, not a broken 206', async () => {
  const res = await ask('bytes=200-300');
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */100');
});

test('a range nobody understands falls back to the whole file', async () => {
  for (const bad of ['bytes=abc', 'bytes=', 'items=0-9', 'bytes=10-5']) {
    const res = await ask(bad);
    assert.equal(res.status === 200 || res.status === 416, true, `${bad} gave ${res.status}`);
    await res.arrayBuffer();
  }
});

test('a missing asset is still a 404, and is not turned into a range', async () => {
  const res = await worker.fetch(
    new Request('https://bot-reborn.agentlenshq.com/media/missing.mp4', { headers: { Range: 'bytes=0-9' } }),
    /** @type {any} */ (env()),
  );
  assert.equal(res.status, 404);
});

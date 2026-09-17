import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CACHE, cachedBytes } from '../web/audio/model-cache.js';

/** A Cache that remembers what was put in it, and counts matches. */
function fakeCaches() {
  /** @type {Map<string, ArrayBuffer>} */ const store = new Map();
  const calls = { open: 0, match: 0, put: 0 };
  return {
    store,
    calls,
    async open(/** @type {string} */ name) {
      calls.open++;
      assert.equal(name, MODEL_CACHE);
      return {
        async match(/** @type {string} */ url) {
          calls.match++;
          const hit = store.get(url);
          return hit ? { arrayBuffer: async () => hit } : undefined;
        },
        async put(/** @type {string} */ url, /** @type {any} */ res) {
          calls.put++;
          store.set(url, await res.arrayBuffer());
        },
      };
    },
  };
}

/** @param {number} n @param {{ ok?: boolean, length?: string | null }} [o] */
function fakeFetch(n, o = {}) {
  const calls = { n: 0, urls: /** @type {string[]} */ ([]) };
  /** @param {string} url */
  const f = async (url) => {
    calls.n++;
    calls.urls.push(url);
    const body = new Uint8Array(n).fill(7);
    return {
      ok: o.ok ?? true,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => (o.length === undefined ? String(n) : o.length) },
      clone: () => ({ arrayBuffer: async () => body.buffer }),
      body: {
        getReader: () => {
          let sent = false;
          return {
            async read() {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: body };
            },
          };
        },
      },
    };
  };
  return { f, calls };
}

test('a miss downloads once, stores it, and hands back the bytes', async () => {
  const c = fakeCaches();
  const { f, calls } = fakeFetch(8);
  const buf = await cachedBytes('/m.wasm', { caches: /** @type {any} */ (c), fetch: /** @type {any} */ (f) });
  assert.equal(buf.byteLength, 8);
  assert.equal(calls.n, 1);
  assert.equal(c.calls.put, 1);
});

test('a hit does not touch the network at all', async () => {
  const c = fakeCaches();
  const first = fakeFetch(8);
  await cachedBytes('/m.wasm', { caches: /** @type {any} */ (c), fetch: /** @type {any} */ (first.f) });
  const second = fakeFetch(8);
  const buf = await cachedBytes('/m.wasm', { caches: /** @type {any} */ (c), fetch: /** @type {any} */ (second.f) });
  assert.equal(second.calls.n, 0, 'the second call fetched anyway');
  assert.equal(buf.byteLength, 8);
});

test('progress reports bytes against the total, and the total may be unknown', async () => {
  const c = fakeCaches();
  /** @type {[number, number][]} */ const seen = [];
  await cachedBytes('/m.wasm', {
    caches: /** @type {any} */ (c),
    fetch: /** @type {any} */ (fakeFetch(8).f),
    onProgress: (got, total) => seen.push([got, total]),
  });
  assert.deepEqual(seen, [[8, 8]]);

  // No content-length is the normal case behind some proxies, and 0 has to read
  // as "unknown" rather than as "an empty file" — a progress bar that divides
  // by it would show NaN%.
  const c2 = fakeCaches();
  /** @type {[number, number][]} */ const seen2 = [];
  await cachedBytes('/n.wasm', {
    caches: /** @type {any} */ (c2),
    fetch: /** @type {any} */ (fakeFetch(8, { length: null }).f),
    onProgress: (got, total) => seen2.push([got, total]),
  });
  assert.deepEqual(seen2, [[8, 0]]);
});

test('a failed download is not stored, so the next start retries it', async () => {
  // Caching a 404 body would make the failure permanent and invisible: the
  // engine would be handed an error page as its wasm, forever, with no network
  // request left to notice.
  const c = fakeCaches();
  await assert.rejects(
    () => cachedBytes('/m.wasm', {
      caches: /** @type {any} */ (c),
      fetch: /** @type {any} */ (fakeFetch(8, { ok: false }).f),
    }),
    /404/,
  );
  assert.equal(c.calls.put, 0);
  assert.equal(c.store.size, 0);
});

test('no Cache API at all still returns the bytes', async () => {
  // Private windows and plain http have no caches. Losing the offline promise
  // is not a reason to refuse to run.
  const { f, calls } = fakeFetch(8);
  const buf = await cachedBytes('/m.wasm', { caches: undefined, fetch: /** @type {any} */ (f) });
  assert.equal(buf.byteLength, 8);
  assert.equal(calls.n, 1);
});

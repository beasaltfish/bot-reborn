// The model's bytes, kept across visits, so "first use needs the network and
// nothing after it does" is a promise something actually keeps (spec §9.1).
//
// Why the Cache API and not the HTTP cache. The HTTP cache is the browser's to
// manage: you cannot ask it what it is holding, and it may drop 19 MB the
// moment the disk gets tight, without telling anyone. That is fine for the
// three glue scripts — 100 KB, and they have to run as <script> anyway — and
// useless for a promise about being offline. Here the bytes are put in by hand
// and taken out by hand, and `caches.match` answers "is it there" before the
// network is ever involved.
//
// Why this can work without a Service Worker: the engine offers two hooks for
// exactly this, `Module.wasmBinary` and `Module.getPreloadedPackage`, so the
// two large files never have to be fetched by emscripten at all. Everything
// else would have needed a worker sitting in front of every request.
//
// §9.2's other half is navigator.storage.persist(), which asks the browser to
// stop counting this origin as evictable. Chrome grants it heuristically and
// may refuse; a refusal is a known state, not an error, which is why the
// caller logs the answer rather than acting on it.

export const MODEL_CACHE = 'bot-reborn-model-v1';

/**
 * @param {string} url
 * @param {{
 *   onProgress?: (loaded: number, total: number) => void,
 *   caches?: CacheStorage,
 *   fetch?: typeof fetch,
 * }} [deps]
 * @returns {Promise<ArrayBuffer>}
 */
export async function cachedBytes(url, deps = {}) {
  const store = 'caches' in deps ? deps.caches : globalThis.caches;
  const f = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const onProgress = deps.onProgress ?? (() => {});

  const cache = store ? await store.open(MODEL_CACHE) : null;
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();

  const res = await f(url);
  // Never cache a failure. A stored 404 body becomes the engine's wasm forever,
  // with no request left for anyone to notice going wrong.
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);

  // clone() before reading, per §9.1: the cache gets its own body and the
  // progress loop gets the other, instead of one of them racing to consume the
  // single stream. The cost is the body buffering until the slower side drains.
  await cache?.put(url, /** @type {any} */ (res.clone()));

  // 0, not NaN, when the header is missing — that happens behind some proxies,
  // and a caller dividing by it wants "unknown", not "an empty file".
  const total = Number(res.headers.get('content-length') ?? 0) || 0;
  const reader = /** @type {any} */ (res.body).getReader();
  /** @type {Uint8Array[]} */ const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }

  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

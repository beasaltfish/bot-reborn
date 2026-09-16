// The only module in the app that touches the fixture cache — the same rule
// config.js follows for localStorage, for the same reason: one definition of
// where these bytes live instead of one per caller.
//
// Cache API rather than IndexedDB, by spec §9.2's argument: a fixture IS the
// response to `fixtures/zh.wav`, so the key is a URL and the value is a
// Response, which is exactly what this store is made of. Two things fall out
// of that and are worth naming, because they are why the rest of the page
// stays short:
//
//   1. `testStt` reads a recording and a file on disk through one code path —
//      both are a Response carrying `content-type: audio/wav`.
//   2. Headers travel with the value, so the recording time rides along in
//      `last-modified` and there is no second store holding metadata.
//
// The cache is best-effort storage and the browser may evict it (§9.2). That
// needs no handling here: a miss degrades to the HTTP fetch, and a miss there
// is the loud "record these first" the STT test already shows.

export const FIXTURE_CACHE = 'voicebot.fixtures';

/** @returns {Promise<Cache | null>} null where `caches` is missing — an
 *  insecure origin, which is also where getUserMedia would have failed first. */
async function open() {
  if (!globalThis.caches) return null;
  return caches.open(FIXTURE_CACHE);
}

/**
 * @param {string} path the same relative path the STT test fetches, so both
 *   resolve against the document base to the same cache key.
 * @param {ArrayBuffer} wav
 * @param {Date} [recordedAt]
 */
export async function saveFixture(path, wav, recordedAt = new Date()) {
  const cache = await open();
  if (!cache) throw new Error('this browser has no Cache API here — recordings cannot be kept');
  await cache.put(path, new Response(wav, {
    headers: {
      'content-type': 'audio/wav',
      'last-modified': recordedAt.toUTCString(),
    },
  }));
}

/** @param {string} path @returns {Promise<Response | null>} */
export async function matchFixture(path) {
  const cache = await open();
  return (await cache?.match(path)) ?? null;
}

/** @param {Response} response @returns {Date | null} */
export function recordedAt(response) {
  const header = response.headers.get('last-modified');
  if (!header) return null;
  const date = new Date(header);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Every stored key under a prefix, as the relative paths they were saved with.
 *
 * setup.html does not need this — its three fixtures are a fixed list in
 * STT_FIXTURES. The audio bench does: its calibration samples are however many
 * you recorded, under `calib/`, and ⑯'s whole method is replaying that set
 * against one parameter after another.
 *
 * @param {string} prefix e.g. 'calib/'
 * @returns {Promise<string[]>} sorted, so the list does not reshuffle per call
 */
export async function listFixtures(prefix) {
  const cache = await open();
  if (!cache) return [];
  const keys = await cache.keys();
  const base = new URL(prefix, location.href).href;
  return keys
    .map((req) => req.url)
    .filter((url) => url.startsWith(base))
    .map((url) => prefix + url.slice(base.length))
    .sort();
}

/** @param {string} path */
export async function deleteFixture(path) {
  const cache = await open();
  await cache?.delete(path);
}

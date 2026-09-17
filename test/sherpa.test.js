import test from 'node:test';
import assert from 'node:assert/strict';

// The glue files are classic scripts that declare top-level classes — Stream,
// CircularBuffer, ExitStatus. Injecting them a second time is an immediate
// "Identifier 'Stream' has already been declared", the engine never
// initialises, and the page hangs forever with the error only in a console no
// phone can show. Measured on a real phone, 2026-09-17.
//
// These fakes stand in for the two globals loadSherpa touches. They are set up
// before the import so the module sees them if it ever reads them at load time.

/** @type {any[]} */ const appended = [];
/** @type {any} */ (globalThis).document = {
  createElement: () => ({ set src(/** @type {string} */ _v) {}, onload: null, onerror: null }),
  body: { appendChild: (/** @type {any} */ el) => void appended.push(el) },
};
// Rich enough for both callers: tokens.txt reads .text(), and the two big
// files go through model-cache.js, which clones, reads content-length and
// drains the body.
/** @type {any} */ (globalThis).fetch = async () => {
  const body = new Uint8Array(4);
  let sent = false;
  return {
    ok: true,
    text: async () => 'a 0\nb 1\n',
    headers: { get: () => '4' },
    clone: () => ({ arrayBuffer: async () => body.buffer }),
    body: {
      getReader: () => ({
        async read() {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: body };
        },
      }),
    },
  };
};
// No Cache API and no navigator here: both are optional by design, and this
// file is about the one-shot property, not about caching.
/** @type {any} */ (globalThis).caches = undefined;

const { loadSherpa } = await import('../web/audio/sherpa.js');

test('loading twice injects the glue once and hands back the same attempt', () => {
  // Neither promise settles here — nothing fakes onRuntimeInitialized — so they
  // are deliberately not awaited. Identity is the whole assertion.
  const first = loadSherpa(() => {}, { timeoutMs: 50 });
  const second = loadSherpa(() => {}, { timeoutMs: 50 });
  assert.equal(first, second, 'the second call must not start a second load');

  // Swallow both, or node fails the file on an unhandled rejection when the
  // 50 ms timeout fires.
  first.catch(() => {});
  second.catch(() => {});
});

test('the glue is appended once, not once per caller', async () => {
  // Injection now happens after the bytes are in hand, so this waits for those
  // awaits to settle. The first script goes in; the other two chain off its
  // onload, which these fakes never fire. The count under test is "one, and
  // not two" — a second loadSherpa would have made it two.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(appended.length, 1, `appended ${appended.length} scripts, expected 1`);
});

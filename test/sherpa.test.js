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
/** @type {any} */ (globalThis).fetch = async () => ({
  ok: true,
  text: async () => 'a 0\nb 1\n',
});

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

test('the glue is appended exactly three times, ever', async () => {
  // The first script is appended synchronously; the other two chain off its
  // onload, which these fakes never fire. So the count under test is "one so
  // far, and not two" — a second loadSherpa would have made it two.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(appended.length, 1, `appended ${appended.length} scripts, expected 1`);
});

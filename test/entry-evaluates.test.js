import test from 'node:test';
import assert from 'node:assert/strict';

// Does the entry file survive its own evaluation?
//
// Nothing else asks this. Every other guard in this suite reads source text,
// and the failure it cannot see is a module that throws on the way down: a
// module that throws simply stops. Every listener after the throw is never
// attached, and the page looks completely normal and does nothing at all.
//
// It happened on 2026-09-21: showPanel() read a `const` declared two hundred
// lines below it and ran during evaluation, which is a temporal dead zone. The
// tabs stopped responding; the markup tests stayed green, because the markup
// was right.
//
// The stub is deliberately dumb. It is not a DOM and does not pretend to be
// one — it answers every call with something shaped enough to keep going, so
// that what surfaces is an error in OUR order of operations rather than a
// missing browser feature.

/** @returns {any} */
const stub = () => ({
  style: {}, dataset: {}, hidden: false, disabled: false,
  textContent: '', value: '', checked: false, scrollTop: 0, scrollHeight: 0,
  classList: { add() {}, remove() {} },
  append() {}, prepend() {}, insertBefore() {}, remove() {},
  addEventListener() {}, setAttribute() {}, getAttribute: () => null,
  querySelector: () => stub(), querySelectorAll: () => [],
  firstElementChild: null, previousElementSibling: null,
});

test('web/dev.js evaluates without throwing', async () => {
  const g = /** @type {any} */ (globalThis);
  g.window = g;
  g.document = {
    getElementById: () => stub(),
    querySelector: () => stub(),
    querySelectorAll: () => [stub()],
    createElement: () => stub(),
    addEventListener() {},
    body: stub(),
  };
  g.location = { pathname: '/dev' };
  // node has a real `navigator` with only a getter, so it is replaced rather
  // than assigned. dev.js reads navigator.usb and must find it absent, not
  // throw.
  Object.defineProperty(g, 'navigator', { value: {}, configurable: true });
  g.fetch = () => Promise.resolve({
    ok: true, status: 200, text: () => Promise.resolve(''),
    headers: { get: () => 'audio/wav' },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    clone() { return this; },
  });
  g.AudioContext = function () {};
  g.Audio = function () { return stub(); };
  g.localStorage = { getItem: () => null, setItem() {} };
  // The connectivity panel refreshes its fixture rows on start, and those go
  // through the Cache API. Stubbed so the work resolves instead of rejecting
  // after this test has already returned.
  g.caches = { open: () => Promise.resolve({ match: () => Promise.resolve(undefined), put: () => Promise.resolve(), keys: () => Promise.resolve([]) }) };
  if (!g.URL.createObjectURL) g.URL.createObjectURL = () => 'blob:';

  await import('../web/dev.js');
  // Let whatever the panels kicked off on start settle, so a rejection lands
  // inside this test rather than after it.
  await new Promise((r) => setTimeout(r, 50));
});

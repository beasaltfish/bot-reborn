import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The same question entry-evaluates.test.js asks of dev.js, asked of the
// product: does app.js survive its own evaluation? Asked in the worst room it
// will be opened in — plain http without the Chrome flag, where the browser
// hides navigator.usb and the microphone (Review Focus 4). The page must still
// come up and say so, not die before its first listener.

/** @returns {any} */
const stub = () => ({
  style: {}, dataset: {}, hidden: false, disabled: false, inert: false,
  textContent: '', value: '', checked: false, scrollTop: 0, scrollHeight: 0,
  classList: { add() {}, remove() {}, toggle() {} },
  append() {}, prepend() {}, remove() {}, replaceChildren() {},
  addEventListener() {}, setAttribute() {}, getAttribute: () => null,
  querySelector: () => stub(), querySelectorAll: () => [],
});

const IDS = new Set(
  [...readFileSync(new URL('../phone/index.html', import.meta.url), 'utf8')
    .matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
);

test('phone/app.js evaluates over plain http, with no WebUSB and no microphone', async () => {
  const g = /** @type {any} */ (globalThis);
  /** @type {string[]} */ const notices = [];
  g.window = g;
  g.isSecureContext = false;
  g.document = {
    getElementById: (/** @type {string} */ id) => {
      if (!IDS.has(id)) return null;
      const el = stub();
      if (id === 'notice') {
        Object.defineProperty(el, 'textContent', { set: (v) => { if (v) notices.push(v); }, get: () => '' });
      }
      return el;
    },
    querySelector: () => stub(),
    querySelectorAll: () => [],
    createElement: () => stub(),
    addEventListener() {},
    hidden: false,
  };
  g.addEventListener = () => {};
  g.location = { hash: '', pathname: '/phone/', host: '192.168.1.5:8787', protocol: 'http:' };
  g.history = { replaceState() {} };
  Object.defineProperty(g, 'navigator', { value: {}, configurable: true });
  g.localStorage = { getItem: () => null, setItem() {} };

  await import('../phone/app.js');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(notices.length > 0, 'an insecure page said nothing about why nothing works');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The boot is a chain of awaits — microphone, AudioContext, car — and a person
// can press the brake (or turn the screen off) in the middle of it. When they
// do, the rest of the chain must not go on to open a link to the brain: that
// link would drive the car with the screen saying it had stopped, and nothing
// left on it to stop it with (final review #1).

const IDS = new Set(
  [...readFileSync(new URL('../phone/index.html', import.meta.url), 'utf8')
    .matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
);

/** An element that remembers its listeners, so a test can press it. */
function element() {
  /** @type {Record<string, Function[]>} */ const on = {};
  /** @type {any} */
  const el = {
    style: {}, dataset: {}, hidden: false, disabled: false, inert: false,
    textContent: '', value: '', checked: false, scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    append() {}, prepend() {}, remove() {}, replaceChildren() {},
    setAttribute() {}, getAttribute: () => null,
    querySelector: () => element(), querySelectorAll: () => [],
    /** @param {string} type @param {Function} fn */
    addEventListener(type, fn) { (on[type] ??= []).push(fn); },
    /** @param {string} type */
    fire(type) { for (const fn of on[type] ?? []) fn({ target: el, preventDefault() {} }); },
  };
  return el;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

/**
 * A page with a microphone the test grants (or one granted at once), a
 * WebSocket it can watch, and either a paired car or none.
 * @param {{ withCar: boolean, micNow?: boolean }} opts
 */
function installPage({ withCar, micNow = false }) {
  const g = /** @type {any} */ (globalThis);
  /** @type {Map<string, any>} */ const els = new Map();
  g.window = g;
  g.isSecureContext = true;
  g.document = {
    getElementById: (/** @type {string} */ id) => {
      if (!IDS.has(id)) return null;
      if (!els.has(id)) els.set(id, element());
      return els.get(id);
    },
    querySelector: () => element(),
    querySelectorAll: () => [],
    createElement: () => element(),
    addEventListener() {},
    hidden: false,
  };
  g.addEventListener = () => {};
  g.location = { hash: '', pathname: '/phone/', host: '192.168.1.5:8787', protocol: 'http:' };
  g.history = { replaceState() {} };
  g.localStorage = {
    getItem: () => JSON.stringify({
      token: 'ab'.repeat(16),
      calibration: { steerSwapped: false, driveSwapped: false, bytesPerMs: null },
    }),
    setItem() {},
  };

  /** @type {(stream: any) => void} */ let grantMic = () => {};
  const ok = async () => ({ status: 'ok', bytesWritten: 1 });
  const device = {
    configuration: {},
    configurations: [{ interfaces: [{ alternates: [{ endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 2 }] }] }] }],
    open: ok, claimInterface: ok, selectConfiguration: ok,
    controlTransferOut: ok, transferOut: ok, controlTransferIn: ok, transferIn: ok,
  };
  Object.defineProperty(g, 'navigator', {
    configurable: true,
    value: {
      usb: { getDevices: async () => (withCar ? [device] : []), addEventListener() {}, requestDevice: async () => device },
      mediaDevices: {
        getUserMedia: micNow
          ? async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [] })
          : () => new Promise((r) => { grantMic = r; }),
      },
    },
  });
  g.AudioContext = function () {
    return {
      state: 'running', currentTime: 0, destination: {}, sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      createMediaStreamSource: () => ({ connect() {} }),
      resume: async () => {}, close: async () => {},
    };
  };
  g.AudioWorkletNode = function () { return { port: { onmessage: null }, disconnect() {} }; };
  let sockets = 0;
  /** @type {any} */ let last = null;
  g.WebSocket = function () {
    sockets++;
    last = {
      readyState: 0, sent: /** @type {string[]} */ ([]),
      send(/** @type {string} */ m) { this.sent.push(m); },
      close() {}, onopen: null, onmessage: null, onclose: null,
    };
    return last;
  };
  return {
    els,
    sockets: () => sockets,
    lastSocket: () => last,
    grantMic: (/** @type {any} */ stream) => grantMic(stream),
  };
}

test('a stop pressed while the microphone is still opening means no link is ever made', async () => {
  const page = installPage({ withCar: true });

  await import('../phone/app.js');
  await settle();
  const fab = page.els.get('fab');
  assert.equal(fab.dataset.tone, 'go', 'the phone was meant to be ready to listen');

  fab.fire('click');              // Listen: the boot starts, and waits for the microphone
  await settle();
  assert.equal(fab.dataset.tone, 'stop');
  fab.fire('click');              // STOP, while the microphone is still being asked for
  await settle();

  page.grantMic({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [] });
  await settle();
  assert.equal(page.sockets(), 0, 'a link to the brain was opened after the user pressed stop');
});

test('with no car paired the phone still listens, links the brain, and ignores a move', async () => {
  const page = installPage({ withCar: false, micNow: true });
  // A second copy of the page: ESM caches by URL, and the first test's copy
  // already ran with a car.
  const fresh = '../phone/app.js?nocar';
  await import(fresh);
  await settle();
  const fab = page.els.get('fab');
  assert.equal(fab.dataset.tone, 'go', 'no car must not stand between the phone and listening');

  fab.fire('click');
  await settle();
  assert.equal(page.sockets(), 1, 'the brain was never linked');
  const ws = page.lastSocket();
  ws.onopen?.({});
  assert.deepEqual(JSON.parse(ws.sent[0]), { type: 'hello', protocol: 2, token: 'ab'.repeat(16) });
  ws.onmessage?.({ data: JSON.stringify({ type: 'welcome', name: 'a' }) });
  // Review Focus 5: orders for a car that is not there are not obeyed, and do not throw.
  ws.onmessage?.({ data: JSON.stringify({ type: 'move', drive: 'forward', steer: 'straight', ms: 600 }) });
  ws.onmessage?.({ data: JSON.stringify({ type: 'stop' }) });
  await settle();
  assert.equal(fab.dataset.tone, 'stop', 'the phone gave up after an order it could not obey');
});

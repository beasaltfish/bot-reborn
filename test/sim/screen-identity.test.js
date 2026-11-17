import test from 'node:test';
import assert from 'node:assert/strict';

import { screenHello, openScreenFeed } from '../../sim/screen-feed.js';
import { screenUrl } from '../../sim/firmware/runtime.js';
import { screenById } from '../../core/screens.js';

test('the screen hello reports the selected profile size', () => {
  const screen = screenById('ili9341-ips');
  assert.ok(screen);
  assert.deepEqual(screenHello('t'.repeat(32), screen).screen, { w: screen.w, h: screen.h });
});

test('the screen URL follows the dialed body URL', () => {
  assert.equal(screenUrl('ws://other:8787/body'), 'ws://other:8787/screen');
  assert.equal(screenUrl('wss://brain/body'), 'wss://brain/screen');
});

test('an explicit screen URL is used, not the page host', () => {
  const oldSocket = globalThis.WebSocket, oldLocation = globalThis.location;
  try {
    /** @type {string[]} */ const urls = [];
    globalThis.WebSocket = /** @type {any} */ (class { constructor(/** @type {string} */ url) { urls.push(url); } addEventListener() {} send() {} close() {} });
    globalThis.location = /** @type {Location} */ (/** @type {unknown} */ ({ protocol: 'http:', host: 'local:8787' }));
    const feed = openScreenFeed({ url: 'ws://other:8787/screen', token: 't'.repeat(32), model: /** @type {any} */ (screenById('ili9341-ips')), onFrame() {} });
    assert.deepEqual(urls, ['ws://other:8787/screen']);
    feed.stop();
  } finally { globalThis.WebSocket = oldSocket; globalThis.location = oldLocation; }
});

import { bodyBoot } from '../../sim/firmware/body-boot.js';
import { BODY } from '../../sim/firmware/body.js';
import { emptyBench } from '../../sim/bench.js';
import { fitRect } from '../../sim/scene/fit.js';

const settings = (over = {}) => ({ ...emptyBench().board.settings, token: 'a'.repeat(32), ...over });
const bootLines = (/** @type {string | null} */ screen, /** @type {string | null} */ wired) => bodyBoot({
  settings: screen ? settings({ screen }) : settings(),
  firmware: BODY,
  bench: emptyBench(),
  outcome: { parts: {}, screenModel: wired },
}).map((e) => e.line ?? '').filter(Boolean);

test('a known panel that answers as chosen prints its identity', () => {
  const ili = bootLines('ili9341-ips', 'ili9341-ips');
  assert.ok(ili.some((line) => line.includes('panel identifies as') && line.includes('as chosen')));
  const st = bootLines('st7789-240', 'st7789-240');
  assert.ok(st.some((line) => line.includes('ST7789') && line.includes('as chosen')));
});

test('a panel of the other controller says so and is still driven as chosen', () => {
  const lines = bootLines('ili9341-ips', 'st7789-240');
  assert.ok(lines.some((line) => line.includes('you chose') && line.includes('answers like')));
});

test('an unplugged MISO or an unknown controller prints no identity line', () => {
  const unwired = bootLines('ili9341-ips', null);
  assert.ok(!unwired.some((line) => line.includes('identifies') || line.includes('answers like')));
  assert.ok(!unwired.includes('screen: ready'));
  const unknown = bootLines('ili9341-ips', 'st7735-160');
  assert.ok(!unknown.some((line) => line.includes('identifies') || line.includes('answers like')));
});

test('the frame is fitted and letterboxed, never stretched', () => {
  assert.deepEqual(fitRect(320, 240, 320, 240), { x: 0, y: 0, w: 320, h: 240, exact: true });
  assert.deepEqual(fitRect(240, 320, 320, 240), { x: 0, y: 70, w: 240, h: 180, exact: false });
  assert.deepEqual(fitRect(160, 128, 320, 240), { x: 0, y: 4, w: 160, h: 120, exact: false });
});

test('a body URL with a query still maps to a clean screen URL', () => {
  assert.equal(screenUrl('ws://other:8787/body?token=x#y'), 'ws://other:8787/screen');
});

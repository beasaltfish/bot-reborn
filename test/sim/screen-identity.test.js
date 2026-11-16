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

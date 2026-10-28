import test from 'node:test';
import assert from 'node:assert/strict';

import { PROTOCOL } from '../../core/protocol.js';
import { screenById } from '../../core/screens.js';
import { screenHello } from '../../sim/screen-feed.js';

test('the hello is the firmware\'s: the same shape, with the panel\'s size', () => {
  assert.deepEqual(screenHello('t', /** @type {any} */ (screenById('st7789-240'))), {
    type: 'hello', protocol: PROTOCOL, token: 't', screen: { w: 240, h: 240 },
  });
});

test('a 320×240 panel reports exactly what the old firmware did not have to', () => {
  const hello = screenHello('abc', /** @type {any} */ (screenById('ili9341-tn')));
  assert.deepEqual(hello.screen, { w: 320, h: 240 });
});

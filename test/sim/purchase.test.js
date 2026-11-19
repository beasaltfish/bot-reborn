import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS } from '../../sim/parts.js';
import { PURCHASE, NO_PURCHASE, purchaseFor } from '../../sim/devices/purchase.js';

test('every part is either purchasable or explicitly marked as not', () => {
  for (const id of Object.keys(PARTS)) {
    if (id.startsWith('screen-')) continue;
    assert.ok(PURCHASE[id] || NO_PURCHASE.has(id), `no purchase decision for ${id}`);
  }
});

test('a purchase entry carries specs, a price and an alternative in both languages', () => {
  const mic = purchaseFor('inmp441');
  assert.ok(mic);
  assert.match(mic.mustMatch.map((m) => m.en).join(' '), /3\.6\s?V/i);
  assert.ok(mic.priceUsd[0] > 0 && mic.priceUsd[1] >= mic.priceUsd[0]);
  assert.ok(mic.alternatives.length >= 1);
  for (const item of [mic.keywords, ...mic.alternatives]) assert.ok(item.en && item.zh, 'both languages');
});

test('consumables have entries too', () => {
  for (const key of ['breadboard', 'jumper-wires', 'usb-cable']) assert.ok(purchaseFor(key), key);
});

test('the board entry names the PSRAM the firmware needs', () => {
  const board = purchaseFor('esp32');
  assert.ok(board);
  const spec = [...board.mustMatch.map((m) => m.en), board.keywords.en].join(' ');
  assert.match(spec, /N16R8|8\s?MB\s+(Octal\s+)?PSRAM/i);
  assert.match(spec, /16\s?MB/i);
});

test('the OLED entry keeps the panel inside 3.3 V', () => {
  const oled = purchaseFor('ssd1306');
  assert.ok(oled);
  const spec = oled.mustMatch.map((m) => m.en).join(' ');
  assert.match(spec, /3\.6\s?V/i);
  for (const alt of oled.alternatives) assert.doesNotMatch(alt.en, /5\s?V/);
});

test('no alternative promises a future firmware driver', () => {
  for (const [id, entry] of Object.entries(PURCHASE)) {
    for (const alt of entry.alternatives) {
      assert.doesNotMatch(alt.en, /if the firmware|once the firmware|future/i, `${id}: ${alt.en}`);
    }
  }
});

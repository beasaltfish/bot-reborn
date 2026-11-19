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

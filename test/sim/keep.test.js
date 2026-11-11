import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyBench, addPart } from '../../sim/bench.js';
import { KEEP_KEY, keepBench, keptBench, dropKept } from '../../sim/keep.js';

/** A Storage-like over a shared map, so a second one is "after a reload". */
function storeOver(/** @type {Map<string, string>} */ map) {
  return {
    getItem: (/** @type {string} */ k) => map.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v),
    removeItem: (/** @type {string} */ k) => void map.delete(k),
  };
}

const sample = () => ({ ...addPart(emptyBench(), 'inmp441', { x: 0, z: 0 }).bench, usb: true });

test('a kept bench comes back as it was, unplugged', () => {
  const store = storeOver(new Map());
  const b = sample();
  keepBench(store, b);
  assert.deepEqual(keptBench(store), { ...b, usb: false });
});

test('nothing kept gives null', () => {
  assert.equal(keptBench(storeOver(new Map())), null);
});

test('a store that throws gives null and no throw', () => {
  const bad = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => keepBench(bad, emptyBench()));
  assert.equal(keptBench(bad), null);
  assert.doesNotThrow(() => dropKept(bad));
});

test('the saved bench survives a reload', () => {
  const map = new Map();
  keepBench(storeOver(map), sample());
  assert.ok(map.has(KEEP_KEY));
  assert.notEqual(keptBench(storeOver(map)), null);
});

test('dropping the kept bench leaves nothing', () => {
  const store = storeOver(new Map());
  keepBench(store, sample());
  dropKept(store);
  assert.equal(keptBench(store), null);
});

test('a kept version 2 bench migrates and stays unplugged', () => {
  const b = sample();
  const old = { ...b, v: 2, placed: b.placed.map(({ properties, ...p }) => p) };
  const store = storeOver(new Map([[KEEP_KEY, JSON.stringify(old)]]));
  assert.deepEqual(keptBench(store), { ...b, usb: false });
});

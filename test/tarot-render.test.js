import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TAROT_CARDS } from '../core/tarot.js';
import { frameSizes, sizeKey } from '../core/screens.js';

const DIR = fileURLToPath(new URL('../server/tarot/cards', import.meta.url));
/** The pet's budget at 320x240, scaled by area (tools/pet/render.js): a frame the ESP32 cannot decode in time is a dropped frame. */
const MAX_BYTES_AT_320x240 = 25 * 1024;

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));

test('the manifest lists every screen size and says how the shuffle plays', () => {
  assert.deepEqual(manifest.sizes, frameSizes().map(sizeKey));
  assert.ok(Number.isInteger(manifest.shuffle.frames) && manifest.shuffle.frames >= 4);
  assert.ok(manifest.shuffle.fps > 0);
});

/** @param {{ w: number, h: number }} size @param {string} file */
function check(size, file) {
  const path = join(DIR, sizeKey(size), file);
  assert.ok(existsSync(path), `${sizeKey(size)}/${file} is missing`);
  const bytes = readFileSync(path);
  assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], `${file} is not a JPEG`);
  const budget = Math.round((MAX_BYTES_AT_320x240 * (size.w * size.h)) / (320 * 240));
  assert.ok(bytes.length <= budget, `${sizeKey(size)}/${file} is ${bytes.length} bytes, over ${budget}`);
  return bytes;
}

test('every screen size has the back, the narrowed back and the shuffle frames, at the screen size', async () => {
  for (const size of frameSizes()) {
    for (const file of ['back.jpg', 'back-narrow.jpg',
      ...Array.from({ length: manifest.shuffle.frames }, (_, i) => `shuffle-${String(i).padStart(3, '0')}.jpg`)]) {
      const meta = await sharp(check(size, file)).metadata();
      assert.deepEqual([meta.width, meta.height], [size.w, size.h], `${sizeKey(size)}/${file}`);
    }
  }
});

test('every card has an upright and a reversed picture, in Chinese and in English, at every size', async () => {
  for (const size of frameSizes()) {
    for (const card of TAROT_CARDS) {
      for (const lang of ['zh', 'en']) {
        for (const stem of [card.id, `${card.id}.r`]) {
          check(size, `${stem}.${lang}.jpg`);
        }
      }
    }
    const meta = await sharp(check(size, `${TAROT_CARDS[0].id}.en.jpg`)).metadata();
    assert.deepEqual([meta.width, meta.height], [size.w, size.h]);
  }
});

test('a card and its reversed twin are different pictures', () => {
  const size = frameSizes()[0];
  const a = check(size, `${TAROT_CARDS[3].id}.en.jpg`);
  const b = check(size, `${TAROT_CARDS[3].id}.r.en.jpg`);
  assert.notDeepEqual(a, b);
});

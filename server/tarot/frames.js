// The tarot screen's pictures as the brain sees them: a manifest plus JPEGs on
// disk, written by tools/tarot/render.js (tarot mode spec §8). Loaded once at
// startup and shared by every robot, the way the pet's frames are.
//
// Layout, per screen size (the directory is `sizeKey`):
//   back.jpg  back-narrow.jpg  shuffle-000.jpg …  <cardId>.<lang>.jpg  <cardId>.r.<lang>.jpg
// The reversed cards are rendered rotated, with their names kept upright: the
// brain has no image library at run time, so it cannot turn a card over live.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{
 *   sizes: string[], fps: number, shuffleCount: number,
 *   back(size: string): Buffer | undefined,
 *   backNarrow(size: string): Buffer | undefined,
 *   shuffle(size: string): Buffer[],
 *   card(size: string, draw: import('../../core/tarot.js').Draw, lang: 'zh' | 'en'): Buffer | undefined,
 * }} TarotFrames
 */

/** @type {TarotFrames} */
const EMPTY = {
  sizes: [], fps: 0, shuffleCount: 0,
  back: () => undefined, backNarrow: () => undefined, shuffle: () => [], card: () => undefined,
};

/**
 * A missing directory is not an error: a tarot character with no frames still
 * connects and still reads aloud, it just has nothing to show. One line says
 * which directory was empty and the robot carries on.
 * @param {string} dir
 * @param {(line: string) => void} [log]
 * @returns {TarotFrames}
 */
export function loadTarotFrames(dir, log = console.log) {
  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    log(`tarot: no frames in ${dir} — the screen will stay blank (npm run tarot:render makes them)`);
    return EMPTY;
  }
  const sizes = Array.isArray(manifest?.sizes) ? manifest.sizes.filter((/** @type {unknown} */ s) => typeof s === 'string') : [];
  const count = Number(manifest?.shuffle?.frames);
  const fps = Number(manifest?.shuffle?.fps);
  if (sizes.length === 0 || !Number.isInteger(count) || count < 0 || !(fps > 0)) {
    log(`tarot: the manifest in ${dir} has no usable sizes or shuffle settings`);
    return EMPTY;
  }

  /** @param {string} size @param {string} name @returns {Buffer | undefined} */
  const read = (size, name) => {
    try { return readFileSync(join(dir, size, name)); } catch { return undefined; }
  };
  /** The small ones are kept; the 78 × 4 cards are read when drawn. @type {Map<string, Buffer | undefined>} */
  const cache = new Map();
  /** @param {string} size @param {string} name */
  const cached = (size, name) => {
    const key = `${size}/${name}`;
    if (!cache.has(key)) cache.set(key, read(size, name));
    return cache.get(key);
  };
  /** @param {string} size */
  const known = (size) => sizes.includes(size);

  return {
    sizes, fps, shuffleCount: count,
    back: (size) => (known(size) ? cached(size, 'back.jpg') : undefined),
    backNarrow: (size) => (known(size) ? cached(size, 'back-narrow.jpg') : undefined),
    shuffle: (size) => {
      if (!known(size)) return [];
      /** @type {Buffer[]} */ const out = [];
      for (let i = 0; i < count; i++) {
        const frame = cached(size, `shuffle-${String(i).padStart(3, '0')}.jpg`);
        if (frame) out.push(frame);
      }
      return out;
    },
    card: (size, draw, lang) => {
      // The id and language become part of a path: only what the deck can make.
      if (!known(size) || !/^[a-z0-9-]+$/.test(draw.id) || (lang !== 'zh' && lang !== 'en')) return undefined;
      return cached(size, `${draw.id}${draw.reversed ? '.r' : ''}.${lang}.jpg`);
    },
  };
}

// Downloads the 78 Rider-Waite-Smith card scans (Pamela Colman Smith, 1909;
// public domain, Wikimedia Commons) into tools/tarot/source/<card id>.jpg.
// The sources are not committed (git-ignored): run this once, then
// `npm run tarot:render`. Files already there are kept.
//
//   node tools/tarot/fetch.js
//
// The Major Arcana scans carry their English title under the picture; they
// are used as they are.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAROT_CARDS } from '../../core/tarot.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'source');
const MAJORS = ['Fool', 'Magician', 'High Priestess', 'Empress', 'Emperor', 'Hierophant', 'Lovers', 'Chariot', 'Strength', 'Hermit',
  'Wheel of Fortune', 'Justice', 'Hanged Man', 'Death', 'Temperance', 'Devil', 'Tower', 'Star', 'Moon', 'Sun', 'Judgement', 'World'];
const STEM = { wands: 'Wands', cups: 'Cups', swords: 'Swords', pentacles: 'Pents' };

/** The Commons file name of a card. @param {import('../../core/tarot.js').Card} card */
export function commonsName(card) {
  const n = Number(card.id.split('-')[1]);
  if (card.arcana === 'major') return `RWS Tarot ${String(n).padStart(2, '0')} ${MAJORS[n]}.jpg`;
  return `${STEM[/** @type {keyof typeof STEM} */ (card.suit)]}${String(n).padStart(2, '0')}.jpg`;
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** curl, not fetch: it follows Commons' redirects through whatever proxy the machine has. @param {string} name */
async function get(name) {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replaceAll(' ', '_'))}?width=800`;
  for (let tries = 0; tries < 5; tries++) {
    try {
      const body = execFileSync('curl', ['-sSfL', '-A', 'bot-reborn-tarot-fetch/1.0 (personal project; public-domain card scans)', url], { maxBuffer: 20 * 1024 * 1024 });
      if (body[0] === 0xff && body[1] === 0xd8) return body; // a JPEG
    } catch { /* retry below */ }
    await sleep(5000 * (tries + 1));
  }
  throw new Error(`could not download ${name}`);
}

mkdirSync(OUT, { recursive: true });
/** @type {string[]} */ const missing = [];
for (const card of TAROT_CARDS) {
  const file = join(OUT, `${card.id}.jpg`);
  if (existsSync(file)) continue;
  try {
    writeFileSync(file, await get(commonsName(card)));
    console.log(card.id, commonsName(card));
  } catch (err) {
    console.error(String(err));
    missing.push(card.id);
  }
  await sleep(2000); // Commons throttles a fast client
}
console.log(`${TAROT_CARDS.length - missing.length}/${TAROT_CARDS.length} cards in ${OUT}${missing.length ? `; missing ${missing.join(' ')}, run again` : ''}`);
if (missing.length) process.exitCode = 1;

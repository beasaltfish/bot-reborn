// Renders the tarot screen's pictures: one set of JPEGs per resolution the
// screen table mentions, in server/tarot/cards/<w>x<h>/, plus a manifest
// (tarot mode spec §8, plan task 6).
//
//   npm run tarot:render
//
// THE ART: the Rider-Waite-Smith scans in tools/tarot/source/<card id>.jpg
// (public domain; `node tools/tarot/fetch.js` downloads them). A card with no
// scan there is drawn as a placeholder instead: a flat colour block and a
// number. The JPEGs are committed: the brain loads
// them at startup, and a machine with no sharp can still run the robot.
//
// FONT: the placeholders draw names in whatever CJK font the machine has (on a
// Mac, PingFang), so the committed JPEGs carry glyphs of a system font that is
// not ours to redistribute, and a render on another machine will differ.
// Spec §8 asks for an open font (Noto Sans SC, OFL) with its licence recorded
// in the repo; fetching it needs the user's approval, so it comes with the real
// art. Until then, do not publish the placeholder JPEGs.
//
// Per size: back.jpg, back-narrow.jpg, shuffle-000.jpg…, and for every card
// <id>.<lang>.jpg and <id>.r.<lang>.jpg. The reversed ones are the face turned
// half a turn with the name kept upright: the brain cannot rotate at run time.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TAROT_CARDS } from '../../core/tarot.js';
import { frameSizes, sizeKey } from '../../core/screens.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'server', 'tarot', 'cards');

const QUALITY = 78;
/** Same budget idea as the pet's: a frame the ESP32 cannot decode in time is dropped. */
const MAX_BYTES_AT_320x240 = 25 * 1024;
const SHUFFLE = { frames: 8, fps: 10 };

const BG = '#14102a';
const FONT = '"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",Helvetica,Arial,sans-serif';
/** Placeholder colours by arcana and suit. */
const COLOUR = { major: '#6b3fa0', wands: '#b5472f', cups: '#2f6db5', swords: '#6d7783', pentacles: '#b8902f' };

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/**
 * Where things go: landscape panels put the card on the left and the name on
 * the right; square and round ones centre the card with the name beneath.
 * @param {{ w: number, h: number }} size
 */
function layout(size) {
  const { w, h } = size;
  if (w > h) {
    const pad = Math.round(h * 0.04);
    const ch = h - 2 * pad;
    const cw = Math.round((ch * 2) / 3);
    const nameX = pad + cw + Math.round(pad * 1.5);
    return {
      card: { x: pad, y: pad, w: cw, h: ch },
      name: { x: nameX, y: pad, w: w - nameX - pad, h: ch, anchor: 'start', fontSize: Math.max(11, Math.round(w * 0.058)) },
    };
  }
  const pad = Math.round(h * 0.035);
  const nameH = Math.round(h * 0.22);
  const ch = h - nameH - 2 * pad;
  const cw = Math.round((ch * 2) / 3);
  return {
    card: { x: Math.round((w - cw) / 2), y: pad, w: cw, h: ch },
    name: { x: Math.round(w / 2), y: pad + ch + pad, w: w - 2 * pad, h: nameH, anchor: 'middle', fontSize: Math.max(12, Math.round(w * 0.07)) },
  };
}

/**
 * Wrap text to lines of at most `max` characters, at spaces for English and
 * anywhere for Chinese.
 * @param {string} text @param {number} max @param {boolean} cjk
 */
function wrap(text, max, cjk) {
  if (cjk) {
    /** @type {string[]} */ const lines = [];
    for (let i = 0; i < text.length; i += max) lines.push(text.slice(i, i + max));
    return lines;
  }
  /** @type {string[]} */ const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The text beside or beneath a card: its name, and which way up it came.
 * @param {ReturnType<typeof layout>['name']} area @param {import('../../core/tarot.js').Card} card
 * @param {'zh' | 'en'} lang @param {boolean} reversed
 */
function nameSvg(area, card, lang, reversed) {
  const cjk = lang === 'zh';
  const name = cjk ? card.zh : card.en;
  const perLine = Math.max(3, Math.floor(area.w / (area.fontSize * (cjk ? 1.05 : 0.55))));
  const lines = wrap(name, perLine, cjk);
  const label = reversed ? (cjk ? '逆位' : 'reversed') : '';
  const lh = Math.round(area.fontSize * 1.3);
  const total = lines.length + (label ? 1 : 0);
  const top = area.anchor === 'start' ? area.y + Math.max(0, Math.round((area.h - total * lh) / 2)) + area.fontSize : area.y + area.fontSize;
  const span = (/** @type {string} */ t, /** @type {number} */ i, /** @type {string} */ fill) =>
    `<text x="${area.x}" y="${top + i * lh}" font-size="${area.fontSize}" font-family='${FONT}' text-anchor="${area.anchor}" fill="${fill}">${esc(t)}</text>`;
  return [
    ...lines.map((l, i) => span(l, i, '#f0e8d8')),
    ...(label ? [span(label, lines.length, '#e9b95a')] : []),
  ].join('');
}

const SOURCE = join(HERE, 'source');

/**
 * The scan of a card, squeezed to the card's box, as an SVG data URI; null
 * when there is no scan on this machine.
 * @param {string} id @param {{ w: number, h: number }} c
 * @returns {Promise<string | null>}
 */
async function scanUri(id, c) {
  const file = join(SOURCE, `${id}.jpg`);
  if (!existsSync(file)) return null;
  const jpg = await sharp(file).resize(c.w, c.h, { fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/**
 * A card's face: its scan when it has one, else a coloured card with its number.
 * @param {{ x: number, y: number, w: number, h: number }} c @param {import('../../core/tarot.js').Card} card
 * @param {boolean} reversed @param {string | null} uri
 */
function drawFace(c, card, reversed, uri) {
  if (uri) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    return `<g transform="rotate(${reversed ? 180 : 0} ${cx} ${cy})"><image x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" href="${uri}"/></g>`;
  }
  const colour = card.arcana === 'major' ? COLOUR.major : COLOUR[/** @type {keyof typeof COLOUR} */ (card.suit ?? 'major')];
  // Majors show their number, minors their rank (1 = ace … 14 = king).
  const number = String(Number(card.id.split('-')[1]));
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const size = Math.round(c.w * 0.5);
  return `<g transform="rotate(${reversed ? 180 : 0} ${cx} ${cy})">
    <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${Math.round(c.w * 0.06)}" fill="${colour}" stroke="#f0e8d8" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="${Math.round(c.w * 0.34)}" fill="none" stroke="#f0e8d8" stroke-opacity="0.5" stroke-width="2"/>
    <text x="${cx}" y="${cy + size * 0.35}" font-size="${size}" font-family='${FONT}' text-anchor="middle" fill="#f0e8d8">${esc(number)}</text>
  </g>`;
}

/**
 * The card back: dark with rings. `squeeze` narrows it for the flip; `dx`/`dy`/`turn` move it for the shuffle.
 * @param {{ x: number, y: number, w: number, h: number }} c
 * @param {{ squeeze?: number, dx?: number, dy?: number, turn?: number }} [move]
 */
function drawBack(c, { squeeze = 1, dx = 0, dy = 0, turn = 0 } = {}) {
  const cx = c.x + c.w / 2 + dx;
  const cy = c.y + c.h / 2 + dy;
  const w = c.w * squeeze;
  const rings = [0.34, 0.22, 0.1].map((r) => `<circle cx="${cx}" cy="${cy}" r="${Math.round(c.w * r * squeeze)}" fill="none" stroke="#e9b95a" stroke-opacity="0.7" stroke-width="2"/>`).join('');
  return `<g transform="rotate(${turn} ${cx} ${cy})">
    <rect x="${cx - w / 2}" y="${cy - c.h / 2}" width="${w}" height="${c.h}" rx="${Math.round(c.w * 0.06)}" fill="#2a2150" stroke="#e9b95a" stroke-width="2"/>${rings}
  </g>`;
}

/** @param {{ w: number, h: number }} size @param {string} body */
const page = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}"><rect width="100%" height="100%" fill="${BG}"/>${body}</svg>`;

/** @param {string} svg */
const jpeg = (svg) => sharp(Buffer.from(svg)).flatten({ background: BG }).jpeg({ quality: QUALITY, chromaSubsampling: '4:2:0' }).toBuffer();

rmSync(OUT, { recursive: true, force: true });
const sizes = frameSizes();
let total = 0;
let over = false;
const jitter = [[0, 0, 0], [7, -3, 4], [-8, 2, -5], [11, 4, 3], [-11, -2, -4], [5, 5, 6], [-5, -5, -6], [0, 0, 0]];

for (const size of sizes) {
  const dir = join(OUT, sizeKey(size));
  mkdirSync(dir, { recursive: true });
  const L = layout(size);
  const budget = Math.round((MAX_BYTES_AT_320x240 * (size.w * size.h)) / (320 * 240));
  /** @param {string} file @param {Buffer} bytes */
  const put = (file, bytes) => {
    writeFileSync(join(dir, file), bytes);
    total += bytes.length;
    if (bytes.length > budget) { console.error(`${sizeKey(size)}/${file}: ${bytes.length} bytes, over the ${budget} budget`); over = true; }
  };

  put('back.jpg', await jpeg(page(size, drawBack(L.card))));
  put('back-narrow.jpg', await jpeg(page(size, drawBack(L.card, { squeeze: 0.35 }))));
  for (let i = 0; i < SHUFFLE.frames; i++) {
    const [dx, dy, turn] = jitter[i % jitter.length];
    const body = [drawBack(L.card, { dx: -dx, dy: -dy, turn: -turn }), drawBack(L.card, { dx, dy, turn })].join('');
    put(`shuffle-${String(i).padStart(3, '0')}.jpg`, await jpeg(page(size, body)));
  }
  for (const card of TAROT_CARDS) {
    const uri = await scanUri(card.id, L.card);
    for (const lang of /** @type {const} */ (['zh', 'en'])) {
      for (const reversed of [false, true]) {
        const body = drawFace(L.card, card, reversed, uri) + nameSvg(L.name, card, lang, reversed);
        put(`${card.id}${reversed ? '.r' : ''}.${lang}.jpg`, await jpeg(page(size, body)));
      }
    }
  }
  console.log(`${sizeKey(size)}: done`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  sizes: sizes.map(sizeKey), shuffle: SHUFFLE, cards: TAROT_CARDS.map((c) => c.id),
}, null, 2) + '\n');
console.log(`tarot cards: ${(total / 1024 / 1024).toFixed(1)} MB in ${OUT}`);
if (over) process.exitCode = 1;

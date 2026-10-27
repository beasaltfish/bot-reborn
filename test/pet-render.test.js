import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ANIMS } from '../tools/pet/anims.js';
import { BG, FLOOR, drawDog, fitDog } from '../tools/pet/dog.js';
import { frameSizes, sizeKey } from '../core/screens.js';

const TRICKS = ['sit', 'shake', 'spin'];

/** @param {string} hex @returns {number[]} */
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * How far an RGB pixel sits from the BG–FLOOR segment: the floor's edge is
 * anti-aliased, so "background" is the whole line between the two colours.
 * @param {number[]} p @param {number[]} a @param {number[]} b
 */
function offSegment(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = Math.max(0, Math.min(1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / len2));
  const c = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
  return Math.hypot(v[0] - (c[0] - a[0]), v[1] - (c[1] - a[1]), v[2] - (c[2] - a[2]));
}
/** The four animations, as the shapes this file asserts on. */
const ALL = /** @type {Record<string, { fps: number, loop: boolean, frames: object[] }>} */ (ANIMS);

test('four animations: idle loops, the three tricks play once', () => {
  assert.deepEqual(Object.keys(ANIMS).sort(), ['idle', 'shake', 'sit', 'spin']);
  assert.equal(ANIMS.idle.loop, true);
  for (const name of TRICKS) {
    assert.equal(ALL[name].loop, false, name);
    assert.ok(ALL[name].fps > 0, name);
    assert.ok(ALL[name].frames.length > 1, `${name} has frames`);
  }
});

test('every frame is an SVG of the screen', () => {
  for (const [name, anim] of Object.entries(ALL)) {
    for (const [i, params] of anim.frames.entries()) {
      const svg = drawDog(params);
      assert.ok(svg.startsWith('<svg'), `${name}[${i}] is an SVG`);
      assert.match(svg, /viewBox="0 0 320 240"/, `${name}[${i}] viewBox`);
      assert.ok(svg.endsWith('</svg>'), `${name}[${i}] closes`);
    }
  }
});

test('a trick ends on the idle first frame, so the hand-back does not jump', () => {
  for (const name of TRICKS) {
    assert.deepEqual(ALL[name].frames.at(-1), ALL.idle.frames[0], name);
  }
});

test('idle is a loop of breaths and one blink, not a still image', () => {
  const frames = (/** @type {any[]} */ (ALL.idle.frames));
  assert.ok(new Set(frames.map((f) => f.breathe)).size > 2, 'breathing moves');
  assert.ok(new Set(frames.map((f) => f.blink)).size > 1, 'it blinks');
  assert.ok(new Set(frames.map((f) => f.tail)).size > 2, 'the tail wags');
});

test('320×240 is drawn exactly as before', () => {
  assert.deepEqual(fitDog(320, 240, false), { scale: 1, dx: 0, dy: 0 });
  assert.equal(drawDog(ANIMS.idle.frames[0]), drawDog(ANIMS.idle.frames[0], { w: 320, h: 240, round: false }));
});

test('every size gets its own canvas', () => {
  for (const s of frameSizes()) assert.match(drawDog({}, s), new RegExp(`viewBox="0 0 ${s.w} ${s.h}"`));
});

test('the dog is never cut off, at any size, in any frame', async () => {
  // Render to raw RGB (no JPEG noise). On the border ring — or, for a round
  // screen, everywhere outside the inscribed circle less 2 px — every pixel
  // must be BG, FLOOR, or a blend of the two (the floor's anti-aliased edge).
  const bg = rgb(BG);
  const floor = rgb(FLOOR);
  for (const s of frameSizes()) {
    for (const [name, anim] of Object.entries(ANIMS)) {
      for (const [i, p] of anim.frames.entries()) {
        const { data, info } = await sharp(Buffer.from(drawDog(p, s)))
          .flatten({ background: BG }).raw().toBuffer({ resolveWithObject: true });
        const cx = info.width / 2;
        const cy = info.height / 2;
        const r = Math.min(info.width, info.height) / 2;
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const onRing = s.round
              ? (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > (r - 2) ** 2
              : x < 2 || y < 2 || x >= info.width - 2 || y >= info.height - 2;
            if (!onRing) continue;
            const px = (y * info.width + x) * info.channels;
            const off = offSegment([data[px], data[px + 1], data[px + 2]], bg, floor);
            // Only build the message when it fails: this loop runs over every
            // border pixel of every frame, and a template per pixel was 30 s.
            if (off > 6) assert.fail(`${sizeKey(s)} ${name}[${i}] (${x},${y}) is ${off.toFixed(1)} off the background`);
          }
        }
      }
    }
  }
});

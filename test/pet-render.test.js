import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ANIMS, POSTURE } from '../tools/pet/anims.js';
import { BG, FLOOR, drawDog, fitDog } from '../tools/pet/dog.js';
import { frameSizes, sizeKey } from '../core/screens.js';

const POSTURES = ['lie', 'sit', 'stand'];
const RESTS = POSTURES.map((p) => `rest-${p}`);
const TRANSITIONS = ['lie-sit', 'sit-lie', 'lie-stand', 'stand-lie', 'sit-stand', 'stand-sit'];
const TRICKS = ['shake', 'spin'];

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
/** The animations, as the shapes this file asserts on. */
const ALL = /** @type {Record<string, { fps: number, loop: boolean, frames: object[] }>} */ (ANIMS);

test('eleven animations: three rest loops, six transitions, two tricks', () => {
  assert.deepEqual(Object.keys(ANIMS).sort(), [...RESTS, ...TRANSITIONS, ...TRICKS].sort());
  assert.deepEqual(RESTS.map((n) => [ALL[n].loop, ALL[n].frames.length, ALL[n].fps]), [[true, 24, 8], [true, 16, 8], [true, 16, 8]]);
  for (const n of TRANSITIONS) assert.deepEqual([ALL[n].loop, ALL[n].frames.length, ALL[n].fps], [false, 8, 10], n);
  assert.deepEqual([ALL.shake.loop, ALL.shake.frames.length, ALL.shake.fps], [false, 16, 10]);
  assert.deepEqual([ALL.spin.loop, ALL.spin.frames.length, ALL.spin.fps], [false, 18, 10]);
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

test('every posture has a rest, and POSTURE is its first frame', () => {
  for (const p of POSTURES) assert.deepEqual(POSTURE[p], ALL[`rest-${p}`].frames[0], p);
});

test('a transition starts on the source rest and ends on the target rest, so it never jumps', () => {
  for (const name of TRANSITIONS) {
    const [from, to] = /** @type {('lie'|'sit'|'stand')[]} */ (name.split('-'));
    assert.deepEqual(ALL[name].frames[0], POSTURE[from], `${name} start`);
    assert.deepEqual(ALL[name].frames.at(-1), POSTURE[to], `${name} end`);
  }
});

test('a trick starts and ends on the rest of the posture it is done in', () => {
  assert.deepEqual(ALL.shake.frames[0], POSTURE.sit);
  assert.deepEqual(ALL.shake.frames.at(-1), POSTURE.sit);
  assert.deepEqual(ALL.spin.frames[0], POSTURE.stand);
  assert.deepEqual(ALL.spin.frames.at(-1), POSTURE.stand);
});

/** The head circle's centre height (the one filled with the dog's fur). */
const headY = (/** @type {string} */ svg) => Number(/<circle cx="160" cy="([\d.]+)" r="4[\d.]+" fill="#f3c877"/.exec(svg)?.[1]);
const legHeight = (/** @type {string} */ svg) => Number(/<rect x="[\d.]+" y="[\d.]+" width="18" height="([\d.]+)"/.exec(svg)?.[1]);

test('lying is unmistakable: the head rests low, well under the sitting head, with the paws in front of the chin', () => {
  const lie = drawDog(POSTURE.lie);
  assert.ok(headY(lie) > headY(drawDog(POSTURE.sit)) + 40, 'head far lower than sitting');
  assert.ok(lie.lastIndexOf('rx="15"') > lie.indexOf('fill="#f3c877"'), 'a paw is drawn after (over) the head');
});

test('standing is taller than lying: longer legs, head up', () => {
  const lie = drawDog(POSTURE.lie);
  const up = drawDog(POSTURE.stand);
  assert.ok(legHeight(up) > legHeight(lie) + 30, 'longer legs when standing');
  assert.ok(headY(up) < headY(lie) - 40, 'head higher when standing');
});

test('a transition never blends through lying on the way from sitting to standing', () => {
  // Half way sit→stand the dog is half sitting and half standing, not half lying.
  const mid = /** @type {any} */ (ALL['sit-stand'].frames[4]);
  assert.ok(mid.sit + mid.stand > 0.95, `sit ${mid.sit} + stand ${mid.stand} stays ~1`);
});

test('the lying rest is a loop of breaths and one blink, not a still image', () => {
  const frames = (/** @type {any[]} */ (ALL['rest-lie'].frames));
  assert.ok(new Set(frames.map((f) => f.breathe)).size > 2, 'breathing moves');
  assert.ok(new Set(frames.map((f) => f.blink)).size > 1, 'it blinks');
  assert.ok(new Set(frames.map((f) => f.tail)).size > 2, 'the tail wags');
});

test('320×240 is drawn exactly as before', () => {
  assert.deepEqual(fitDog(320, 240, false), { scale: 1, dx: 0, dy: 0 });
  assert.equal(drawDog(ANIMS['rest-lie'].frames[0]), drawDog(ANIMS['rest-lie'].frames[0], { w: 320, h: 240, round: false }));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMS } from '../tools/pet/anims.js';
import { drawDog } from '../tools/pet/dog.js';

const TRICKS = ['sit', 'shake', 'spin'];
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

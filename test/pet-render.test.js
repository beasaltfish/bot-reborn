import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMS } from '../tools/pet/anims.js';
import { drawDog } from '../tools/pet/dog.js';

const TRICKS = ['sit', 'shake', 'spin'];

test('four animations: idle loops, the three tricks play once', () => {
  assert.deepEqual(Object.keys(ANIMS).sort(), ['idle', 'shake', 'sit', 'spin']);
  assert.equal(ANIMS.idle.loop, true);
  for (const name of TRICKS) {
    assert.equal(ANIMS[name].loop, false, name);
    assert.ok(ANIMS[name].fps > 0, name);
    assert.ok(ANIMS[name].frames.length > 1, `${name} has frames`);
  }
});

test('every frame is an SVG of the screen', () => {
  for (const [name, anim] of Object.entries(ANIMS)) {
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
    assert.deepEqual(ANIMS[name].frames.at(-1), ANIMS.idle.frames[0], name);
  }
});

test('idle is a loop of breaths and one blink, not a still image', () => {
  const frames = ANIMS.idle.frames;
  assert.ok(new Set(frames.map((f) => f.breathe)).size > 2, 'breathing moves');
  assert.ok(new Set(frames.map((f) => f.blink)).size > 1, 'it blinks');
  assert.ok(new Set(frames.map((f) => f.tail)).size > 2, 'the tail wags');
});

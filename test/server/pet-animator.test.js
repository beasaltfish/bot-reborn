import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Animator } from '../../server/pet/animator.js';
import { loadPetFrames } from '../../server/pet/frames.js';
import { FakeClock } from './fake-clock.js';

const buf = (/** @type {string} */ s) => Buffer.from(s);

/**
 * One animation with frames for two sizes: `wide` for a 320×240 screen,
 * `square` for a 240×240 one. The numbers say which frame it is.
 * @param {number} fps @param {boolean} loop @param {string[]} wide @param {string[]} square
 */
const sized = (fps, loop, wide, square) => ({
  fps, loop, count: wide.length,
  bySize: new Map([['320x240', wide.map(buf)], ['240x240', square.map(buf)]]),
});

/** Idle: 3 frames at 10 fps, looping. Sit: 2 frames, once. */
function rig() {
  const clock = new FakeClock();
  /** @type {Buffer[]} */ const shown = [];
  /** @type {string[][]} */ const pairs = [];
  /** @type {string[]} */ const logged = [];
  const frames = new Map([
    ['idle', sized(10, true, ['i0', 'i1', 'i2'], ['j0', 'j1', 'j2'])],
    ['sit', sized(10, false, ['s0', 's1'], ['t0', 't1'])],
  ]);
  const animator = new Animator({
    frames,
    show: (pick) => {
      const wide = pick('320x240');
      const square = pick('240x240');
      shown.push(/** @type {Buffer} */ (wide));
      pairs.push([wide?.toString() ?? 'none', square?.toString() ?? 'none']);
    },
    after: clock.after,
    log: (line) => logged.push(line),
  });
  return { clock, shown, pairs, logged, frames, animator };
}

const names = (/** @type {Buffer[]} */ shown) => shown.map((b) => b.toString());

test('start shows idle frame 0 at once and loops', async () => {
  const r = rig();
  r.animator.start();
  assert.deepEqual(names(r.shown), ['i0']);
  await r.clock.advance(300);
  assert.deepEqual(names(r.shown), ['i0', 'i1', 'i2', 'i0']);
});

test('pose switches at once, plays once, and returns to idle from frame 0', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('sit');
  assert.deepEqual(names(r.shown), ['i0', 's0'], 'the switch does not wait for a tick');
  await r.clock.advance(200);
  assert.deepEqual(names(r.shown), ['i0', 's0', 's1', 'i0'], 's1, then straight back to idle');
});

test('every size is handed the same frame of the same animation', async () => {
  const r = rig();
  r.animator.start();
  await r.clock.advance(200);
  r.animator.pose('sit');
  await r.clock.advance(100);
  assert.deepEqual(r.pairs, [
    ['i0', 'j0'], ['i1', 'j1'], ['i2', 'j2'], ['s0', 't0'], ['s1', 't1'],
  ]);
});

test('a pick for a size with no frames is undefined, not a crash', () => {
  /** @type {(Buffer | undefined)[]} */ const picked = [];
  const animator = new Animator({
    frames: new Map([['idle', sized(10, true, ['i0'], ['j0'])]]),
    show: (pick) => picked.push(pick('999x1')),
    after: () => () => {},
  });
  animator.start();
  assert.deepEqual(picked, [undefined]);
});

test('a pose during a pose restarts with the new one', async () => {
  const r = rig();
  const frames = r.frames;
  frames.set('shake', sized(10, false, ['h0', 'h1'], ['k0', 'k1']));
  r.animator.start();
  r.animator.pose('sit');
  await r.clock.advance(100);
  r.animator.pose('shake');
  assert.deepEqual(names(r.shown), ['i0', 's0', 's1', 'h0']);
  await r.clock.advance(100);
  assert.deepEqual(names(r.shown).slice(-1), ['h1']);
});

test('pose without an animation is ignored, and the idle keeps going', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('roll-over');
  assert.deepEqual(r.logged.length, 1);
  assert.match(r.logged[0], /roll-over/);
  await r.clock.advance(100);
  assert.deepEqual(names(r.shown), ['i0', 'i1']);
});

test('stop stops the frames; start after stop restarts idle', async () => {
  const r = rig();
  r.animator.start();
  await r.clock.advance(100);
  r.animator.stop();
  await r.clock.advance(1000);
  assert.deepEqual(names(r.shown), ['i0', 'i1']);
  r.animator.start();
  await r.clock.advance(100);
  assert.deepEqual(names(r.shown), ['i0', 'i1', 'i0', 'i1']);
});

test('a pose while stopped is not played', async () => {
  const r = rig();
  r.animator.pose('sit');
  await r.clock.advance(500);
  assert.deepEqual(names(r.shown), []);
});

test('loads nothing from a missing directory, and says so once', () => {
  /** @type {string[]} */ const logged = [];
  const frames = loadPetFrames(join(tmpdir(), 'no-such-pet-frames-xyz'), (l) => logged.push(l));
  assert.equal(frames.size, 0);
  assert.equal(logged.length, 1);
});

test('loads every size of a sized manifest, in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pet-frames-'));
  for (const [size, prefix] of [['320x240', 'a'], ['240x240', 'b']]) {
    mkdirSync(join(dir, size, 'idle'), { recursive: true });
    writeFileSync(join(dir, size, 'idle', '000.jpg'), `${prefix}0`);
    writeFileSync(join(dir, size, 'idle', '001.jpg'), `${prefix}1`);
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    sizes: ['320x240', '240x240'],
    anims: { idle: { fps: 8, loop: true, frames: 2 } },
  }));
  /** @type {string[]} */ const logged = [];
  const frames = loadPetFrames(dir, (l) => logged.push(l));
  const idle = frames.get('idle');
  assert.equal(idle?.fps, 8);
  assert.equal(idle?.loop, true);
  assert.equal(idle?.count, 2);
  assert.deepEqual(idle?.bySize.get('320x240')?.map(String), ['a0', 'a1']);
  assert.deepEqual(idle?.bySize.get('240x240')?.map(String), ['b0', 'b1']);
  assert.deepEqual(logged, []);
});

test('one size missing one frame leaves the whole animation out, with one line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pet-frames-'));
  for (const [size, prefix] of [['320x240', 'a'], ['240x240', 'b']]) {
    mkdirSync(join(dir, size, 'idle'), { recursive: true });
    writeFileSync(join(dir, size, 'idle', '000.jpg'), `${prefix}0`);
  }
  // The 320×240 column is complete; the 240×240 one stops after its first frame.
  writeFileSync(join(dir, '320x240', 'idle', '001.jpg'), 'a1');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    sizes: ['320x240', '240x240'],
    anims: { idle: { fps: 8, loop: true, frames: 2 } },
  }));
  /** @type {string[]} */ const logged = [];
  const frames = loadPetFrames(dir, (l) => logged.push(l));
  assert.equal(frames.size, 0, 'a stuttering half-animation is worse than none');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /idle/);
});

test('a manifest from before screen sizes is refused with one line saying how to fix it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pet-frames-'));
  mkdirSync(join(dir, 'idle'), { recursive: true });
  writeFileSync(join(dir, 'idle', '000.jpg'), 'a');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    width: 320, height: 240,
    anims: { idle: { fps: 8, loop: true, frames: 1 } },
  }));
  /** @type {string[]} */ const logged = [];
  const frames = loadPetFrames(dir, (l) => logged.push(l));
  assert.equal(frames.size, 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /npm run pet:render/);
});

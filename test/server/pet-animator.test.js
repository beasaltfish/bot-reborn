import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Animator } from '../../server/pet/animator.js';
import { loadPetFrames } from '../../server/pet/frames.js';
import { FakeClock } from './fake-clock.js';

const buf = (/** @type {string} */ s) => Buffer.from(s);

/** Idle: 3 frames at 10 fps, looping. Sit: 2 frames, once. */
function rig() {
  const clock = new FakeClock();
  /** @type {Buffer[]} */ const shown = [];
  /** @type {string[]} */ const logged = [];
  const frames = new Map([
    ['idle', { fps: 10, loop: true, frames: [buf('i0'), buf('i1'), buf('i2')] }],
    ['sit', { fps: 10, loop: false, frames: [buf('s0'), buf('s1')] }],
  ]);
  const animator = new Animator({
    frames,
    show: (jpeg) => shown.push(jpeg),
    after: clock.after,
    log: (line) => logged.push(line),
  });
  return { clock, shown, logged, frames, animator };
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

test('a pose during a pose restarts with the new one', async () => {
  const r = rig();
  const frames = r.frames;
  frames.set('shake', { fps: 10, loop: false, frames: [buf('h0'), buf('h1')] });
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

test('loads the manifest\'s frames in order, and leaves out an animation with a hole', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pet-frames-'));
  mkdirSync(join(dir, 'idle'), { recursive: true });
  mkdirSync(join(dir, 'sit'), { recursive: true });
  writeFileSync(join(dir, 'idle', '000.jpg'), 'a');
  writeFileSync(join(dir, 'idle', '001.jpg'), 'b');
  writeFileSync(join(dir, 'sit', '000.jpg'), 'c');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    width: 320, height: 240,
    anims: { idle: { fps: 8, loop: true, frames: 2 }, sit: { fps: 10, loop: false, frames: 2 } },
  }));
  /** @type {string[]} */ const logged = [];
  const frames = loadPetFrames(dir, (l) => logged.push(l));
  assert.deepEqual([...frames.keys()], ['idle'], 'sit is missing its second frame');
  assert.deepEqual(frames.get('idle')?.frames.map(String), ['a', 'b']);
  assert.equal(frames.get('idle')?.fps, 8);
  assert.equal(frames.get('idle')?.loop, true);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /sit/);
});

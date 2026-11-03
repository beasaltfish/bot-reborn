import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Animator, RELAX_MS } from '../../server/pet/animator.js';
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

const REST_LOOPS = ['rest-lie', 'rest-sit', 'rest-stand'];
const ONCE = ['lie-sit', 'sit-lie', 'lie-stand', 'stand-lie', 'sit-stand', 'stand-sit', 'shake', 'spin'];

/** Every animation of the postures spec, two frames at 10 fps, each frame labelled `name:index`. */
function allAnims(/** @type {string[]} */ without = []) {
  const frames = new Map();
  for (const name of [...REST_LOOPS, ...ONCE]) {
    if (without.includes(name)) continue;
    const loop = REST_LOOPS.includes(name);
    frames.set(name, sized(10, loop, [`${name}:0`, `${name}:1`], [`${name}~0`, `${name}~1`]));
  }
  return frames;
}

function rig(/** @type {string[]} */ without = []) {
  const clock = new FakeClock();
  /** @type {Buffer[]} */ const shown = [];
  /** @type {string[][]} */ const pairs = [];
  /** @type {string[]} */ const logged = [];
  const frames = allAnims(without);
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
/** Which animations have been shown, in order, each once however many frames it had. */
const played = (/** @type {Buffer[]} */ shown) => names(shown).map((n) => n.split(':')[0]).filter((n, i, all) => n !== all[i - 1]);

/** A dog that has been told to sit and has settled into it. */
async function sitting(/** @type {ReturnType<typeof rig>} */ r) {
  r.animator.start();
  r.animator.pose('sit');
  await r.clock.advance(200);   // lie-sit takes 200 ms; at 200 the sitting rest has just begun
  assert.equal(played(r.shown).at(-1), 'rest-sit');
}

test('start shows the lying rest at once and loops it', async () => {
  const r = rig();
  r.animator.start();
  assert.deepEqual(names(r.shown), ['rest-lie:0']);
  await r.clock.advance(300);
  assert.deepEqual(names(r.shown), ['rest-lie:0', 'rest-lie:1', 'rest-lie:0', 'rest-lie:1']);
});

test('sit from lying plays the transition at once, then holds the sitting rest', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('sit');
  assert.deepEqual(names(r.shown).slice(-1), ['lie-sit:0'], 'the switch does not wait for a tick');
  await r.clock.advance(1000);
  assert.deepEqual(played(r.shown), ['rest-lie', 'lie-sit', 'rest-sit'], 'and it stays sitting');
});

test('the same pose again changes nothing on screen', async () => {
  const r = rig();
  await sitting(r);
  const before = r.shown.length;
  r.animator.pose('sit');
  assert.equal(r.shown.length, before, 'no new frame and no transition');
});

test('stand from sitting goes straight across, and stand from standing is nothing', async () => {
  const r = rig();
  await sitting(r);
  r.animator.pose('stand');
  await r.clock.advance(1000);
  assert.deepEqual(played(r.shown).slice(-2), ['sit-stand', 'rest-stand']);
});

test('shake from lying sits first, shakes, and stays sitting', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('shake');
  await r.clock.advance(1000);
  assert.deepEqual(played(r.shown), ['rest-lie', 'lie-sit', 'shake', 'rest-sit']);
});

test('shake from sitting needs no transition', async () => {
  const r = rig();
  await sitting(r);
  r.animator.pose('shake');
  await r.clock.advance(1000);
  assert.deepEqual(played(r.shown).slice(-2), ['shake', 'rest-sit']);
});

test('spin from lying stands first, spins, and stays standing', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('spin');
  await r.clock.advance(1000);
  assert.deepEqual(played(r.shown), ['rest-lie', 'lie-stand', 'spin', 'rest-stand']);
});

test('lie from standing goes down and stays down', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('stand');
  await r.clock.advance(1000);
  r.animator.pose('lie');
  await r.clock.advance(RELAX_MS * 3);
  assert.deepEqual(played(r.shown), ['rest-lie', 'lie-stand', 'rest-stand', 'stand-lie', 'rest-lie']);
});

test('nobody talking for RELAX_MS: it relaxes to lying with a transition', async () => {
  const r = rig();
  await sitting(r);
  await r.clock.advance(RELAX_MS - 100);
  assert.equal(played(r.shown).at(-1), 'rest-sit', 'not yet');
  await r.clock.advance(200);
  await r.clock.advance(1000);
  assert.deepEqual(played(r.shown).slice(-3), ['rest-sit', 'sit-lie', 'rest-lie']);
});

test('a pose restarts the relax timer, even the same pose', async () => {
  const r = rig();
  await sitting(r);
  await r.clock.advance(RELAX_MS - 100);
  r.animator.pose('sit');
  await r.clock.advance(RELAX_MS - 100);
  assert.equal(played(r.shown).at(-1), 'rest-sit', 'a full RELAX_MS has not passed since the last pose');
  await r.clock.advance(150);   // it fires 100 ms in; sit-lie is 200 ms long
  assert.equal(played(r.shown).at(-1), 'sit-lie');
});

test('the relax timer never cuts a trick short: it starts when the trick ends', async () => {
  const r = rig();
  await sitting(r);
  await r.clock.advance(RELAX_MS - 150);
  r.animator.pose('shake');                 // 200 ms long: it would have been mid-trick when the old timer fired
  await r.clock.advance(150);
  assert.equal(played(r.shown).at(-1), 'shake', 'the trick is still playing');
  await r.clock.advance(100);               // shake over, rest-sit again
  await r.clock.advance(RELAX_MS - 100);
  assert.equal(played(r.shown).at(-1), 'rest-sit', 'a fresh RELAX_MS from the end of the trick');
  await r.clock.advance(200);
  assert.equal(played(r.shown).at(-1), 'sit-lie');
});

test('a pose during a transition starts the new sequence at once from where it was heading', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('sit');                   // lie-sit, heading for sitting
  await r.clock.advance(100);               // in its second frame
  r.animator.pose('stand');
  assert.equal(names(r.shown).at(-1), 'sit-stand:0', 'from sitting, the posture it was heading to');
  await r.clock.advance(1000);
  assert.equal(played(r.shown).at(-1), 'rest-stand');
});

test('a missing transition cuts to the rest, with one line', async () => {
  const r = rig(['lie-sit']);
  r.animator.start();
  r.animator.pose('sit');
  assert.equal(names(r.shown).at(-1), 'rest-sit:0');
  assert.equal(r.logged.length, 1);
  assert.match(r.logged[0], /lie-sit/);
});

test('a pose with no animation at all is ignored, and the dog keeps going', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('dance');
  assert.equal(r.logged.length, 1);
  await r.clock.advance(200);
  assert.deepEqual(played(r.shown), ['rest-lie']);
});

test('every size is handed the same frame of the same animation', async () => {
  const r = rig();
  r.animator.start();
  r.animator.pose('sit');
  await r.clock.advance(150);
  for (const [wide, square] of r.pairs) {
    assert.equal(wide.replace(':', '~'), square, 'one player, two crops of the same frame');
  }
});

test('stop stops the frames and the timers; start after stop begins again lying', async () => {
  const r = rig();
  await sitting(r);
  r.animator.stop();
  const seen = r.shown.length;
  await r.clock.advance(RELAX_MS * 2);
  assert.equal(r.shown.length, seen, 'nothing more after stop, not even a relax');
  r.animator.start();
  assert.equal(names(r.shown).at(-1), 'rest-lie:0');
});

test('a pose while stopped is not played', async () => {
  const r = rig();
  r.animator.pose('sit');
  await r.clock.advance(500);
  assert.deepEqual(r.shown, []);
});

test('a pick for a size with no frames is undefined, not a crash', () => {
  const r = rig();
  const frames = new Map([['rest-lie', sized(10, true, ['i0'], ['j0'])]]);
  frames.get('rest-lie')?.bySize.delete('240x240');
  /** @type {(Buffer | undefined)[]} */ const got = [];
  const animator = new Animator({ frames, show: (pick) => { got.push(pick('240x240')); }, after: r.clock.after });
  animator.start();
  assert.deepEqual(got, [undefined]);
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

test('with no logger, the missing-frames hint still reaches the console', () => {
  // main.js loads the frames with no logger of its own. If the default were a
  // no-op, the one line a person needs — "run npm run pet:render" — would be
  // written into nothing, and the brain would just show a blank screen.
  const dir = mkdtempSync(join(tmpdir(), 'pet-frames-'));
  mkdirSync(join(dir, 'idle'), { recursive: true });
  writeFileSync(join(dir, 'idle', '000.jpg'), 'a');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    width: 320, height: 240,
    anims: { idle: { fps: 8, loop: true, frames: 1 } },
  }));
  /** @type {string[]} */ const said = [];
  const real = console.log;
  console.log = (/** @type {any[]} */ ...args) => { said.push(args.join(' ')); };
  try {
    loadPetFrames(dir);
  } finally {
    console.log = real;
  }
  assert.equal(said.length, 1);
  assert.match(said[0], /npm run pet:render/);
});

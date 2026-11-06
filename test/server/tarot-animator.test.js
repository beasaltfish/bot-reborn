import test from 'node:test';
import assert from 'node:assert/strict';
import { TarotAnimator, SHUFFLE_MIN_MS } from '../../server/tarot/animator.js';
import { TarotExecutor } from '../../server/body/tarot.js';
import { FakeClock } from './fake-clock.js';

const buf = (/** @type {string} */ s) => Buffer.from(s);

/** Frames whose bytes say what they are, so a test can read what the screen shows. */
function labelled() {
  /** @type {any} */
  const frames = {
    sizes: ['320x240'],
    fps: 10,
    shuffleCount: 3,
    back: (/** @type {string} */ size) => (size === '320x240' ? buf('back') : undefined),
    backNarrow: (/** @type {string} */ size) => (size === '320x240' ? buf('narrow') : undefined),
    shuffle: (/** @type {string} */ size) => (size === '320x240' ? [buf('s0'), buf('s1'), buf('s2')] : []),
    card: (/** @type {string} */ size, /** @type {any} */ draw, /** @type {string} */ lang) =>
      (size === '320x240' ? buf(`card:${draw.id}:${draw.reversed ? 'r' : 'u'}:${lang}`) : undefined),
  };
  return frames;
}

function rig({ lang = 'en' } = {}) {
  const clock = new FakeClock();
  /** @type {string[]} */ const shown = [];
  /** @type {string[]} */ const logged = [];
  /** @type {Array<(size: string) => Buffer | undefined>} */ const picks = [];
  const animator = new TarotAnimator({
    frames: labelled(),
    show: (pick) => { picks.push(pick); shown.push(pick('320x240')?.toString() ?? 'none'); },
    after: clock.after,
    log: (line) => logged.push(line),
    lang: () => /** @type {'zh' | 'en'} */ (lang),
  });
  return { animator, clock, shown, logged, picks };
}

const CARD = { id: 'major-00', reversed: false };

test('start shows the card back, and nothing moves until a draw', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  assert.deepEqual(shown, ['back']);
  await clock.advance(10000);
  assert.deepEqual(shown, ['back']);
});

test('a draw shuffles, cycling the frames, and keeps cycling past the minimum', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.draw(CARD);
  assert.equal(shown.at(-1), 's0');
  await clock.advance(100);
  assert.equal(shown.at(-1), 's1');
  await clock.advance(100);
  assert.equal(shown.at(-1), 's2');
  await clock.advance(100);
  assert.equal(shown.at(-1), 's0', 'wraps round');
  await clock.advance(SHUFFLE_MIN_MS * 3);
  assert.ok(shown.at(-1)?.startsWith('s'), 'still shuffling: no reveal was asked for');
});

test('reveal before the minimum waits for it, then flips through the narrow card to the face', async () => {
  const { animator, clock, shown } = rig({ lang: 'zh' });
  animator.start();
  animator.draw({ id: 'cups-03', reversed: true });
  await clock.advance(500);
  animator.reveal();
  await clock.advance(500);
  assert.ok(shown.at(-1)?.startsWith('s'), 'not before the minimum');
  await clock.advance(SHUFFLE_MIN_MS);
  assert.deepEqual(shown.slice(-2), ['narrow', 'card:cups-03:r:zh']);
});

test('reveal after the minimum flips at once, and the card then stays until the next draw', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.draw(CARD);
  await clock.advance(SHUFFLE_MIN_MS + 50);
  animator.reveal();
  await clock.advance(1000);
  assert.deepEqual(shown.slice(-2), ['narrow', 'card:major-00:u:en']);
  const count = shown.length;
  await clock.advance(60000);
  assert.equal(shown.length, count, 'nothing changes while the card is held');
});

test('a draw while holding or shuffling starts the shuffle again', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.draw(CARD);
  await clock.advance(SHUFFLE_MIN_MS + 50);
  animator.reveal();
  await clock.advance(1000);
  animator.draw({ id: 'swords-02', reversed: false });
  assert.equal(shown.at(-1), 's0');
  animator.reveal();
  await clock.advance(SHUFFLE_MIN_MS + 500);
  assert.equal(shown.at(-1), 'card:swords-02:u:en');
});

test('a reveal with nothing drawn does nothing', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.reveal();
  await clock.advance(5000);
  assert.deepEqual(shown, ['back']);
});

test('stop cancels everything, and a later start shows the card back again', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.draw(CARD);
  await clock.advance(200);
  animator.stop();
  const count = shown.length;
  await clock.advance(10000);
  assert.equal(shown.length, count, 'nothing is pushed after stop');
  animator.draw(CARD);
  assert.equal(shown.length, count, 'a draw while stopped is ignored');
  animator.start();
  assert.equal(shown.at(-1), 'back');
});

test('a screen size with no frames gets nothing, and nothing throws', () => {
  const { animator, picks } = rig();
  animator.start();
  animator.draw(CARD);
  for (const pick of picks) assert.equal(pick('999x999'), undefined);
});

test('the executor forwards draw and reveal to the animator and never moves', async () => {
  /** @type {string[]} */ const calls = [];
  const fake = { draw: (/** @type {any} */ c) => calls.push(`draw:${c.id}`), reveal: () => calls.push('reveal') };
  const exec = new TarotExecutor(/** @type {any} */ (fake));
  await exec.draw(CARD);
  await exec.reveal();
  await Promise.all([exec.move(), exec.cruise(), exec.stop()]);
  assert.deepEqual(calls, ['draw:major-00', 'reveal']);
  assert.equal(exec.connected, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { TarotAnimator, SHUFFLE_MIN_MS, REFRESH_MS } from '../../server/tarot/animator.js';
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

/** What the screen showed, with a frame sent again (the refresh) counted once. @param {string[]} frames */
const distinct = (frames) => frames.filter((f, i) => i === 0 || f !== frames[i - 1]);

test('start shows the card back, and it is only ever the card back until a draw', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  assert.deepEqual(shown, ['back']);
  await clock.advance(10000);
  assert.ok(shown.every((f) => f === 'back'), `shown: ${shown.join(',')}`);
});

test('at rest the card back is sent again about once a second, so a screen that connects late sees it', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  await clock.advance(REFRESH_MS * 3 + 50);
  assert.equal(shown.length, 1 + 3);
  animator.stop();
  const count = shown.length;
  await clock.advance(REFRESH_MS * 5);
  assert.equal(shown.length, count, 'and not after stop');
});

test('a held card is sent again too, so a dropped frame or a screen that reconnects gets it back', async () => {
  const { animator, clock, shown } = rig({ lang: 'zh' });
  animator.start();
  animator.draw({ id: 'cups-03', reversed: true });
  await clock.advance(SHUFFLE_MIN_MS + 50);
  animator.reveal();
  await clock.advance(500);
  assert.equal(shown.at(-1), 'card:cups-03:r:zh');
  const count = shown.length;
  await clock.advance(REFRESH_MS * 2 + 50);
  assert.deepEqual(shown.slice(count), ['card:cups-03:r:zh', 'card:cups-03:r:zh']);
});

test('while shuffling there is no extra refresh on top of the shuffle frames', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.draw(CARD);
  const before = shown.length;
  await clock.advance(1000);
  // 10 fps for a second is ten shuffle frames; a refresh would have put the back among them.
  assert.equal(shown.length - before, 10);
  assert.ok(shown.slice(before).every((f) => f.startsWith('s')), shown.slice(before).join(','));
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
  assert.deepEqual(distinct(shown).slice(-2), ['narrow', 'card:cups-03:r:zh']);
});

test('reveal after the minimum flips at once, and the card then stays until the next draw', async () => {
  const { animator, clock, shown } = rig();
  animator.start();
  animator.draw(CARD);
  await clock.advance(SHUFFLE_MIN_MS + 50);
  animator.reveal();
  await clock.advance(1000);
  assert.deepEqual(distinct(shown).slice(-2), ['narrow', 'card:major-00:u:en']);
  const count = shown.length;
  await clock.advance(60000);
  assert.ok(shown.slice(count).every((f) => f === 'card:major-00:u:en'), 'only the held card, again and again');
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
  assert.deepEqual(distinct(shown), ['back']);
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

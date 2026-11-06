import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTarotFrames } from '../../server/tarot/frames.js';

/** A frames directory shaped the way the render tool writes it, with tiny stand-in files. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tarot-frames-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ sizes: ['320x240'], shuffle: { frames: 2, fps: 8 } }));
  const size = join(dir, '320x240');
  mkdirSync(size);
  for (const [name, body] of Object.entries({
    'back.jpg': 'back', 'back-narrow.jpg': 'narrow',
    'shuffle-000.jpg': 's0', 'shuffle-001.jpg': 's1',
    'major-00.en.jpg': 'fool-up-en', 'major-00.r.en.jpg': 'fool-rev-en',
  })) writeFileSync(join(size, name), body);
  return dir;
}

test('it loads what the render tool wrote: back, narrow back, shuffle frames, cards', () => {
  const frames = loadTarotFrames(fixture(), () => {});
  assert.deepEqual(frames.sizes, ['320x240']);
  assert.equal(frames.fps, 8);
  assert.equal(frames.shuffleCount, 2);
  assert.equal(frames.back('320x240')?.toString(), 'back');
  assert.equal(frames.backNarrow('320x240')?.toString(), 'narrow');
  assert.deepEqual(frames.shuffle('320x240').map(String), ['s0', 's1']);
  assert.equal(frames.card('320x240', { id: 'major-00', reversed: false }, 'en')?.toString(), 'fool-up-en');
  assert.equal(frames.card('320x240', { id: 'major-00', reversed: true }, 'en')?.toString(), 'fool-rev-en');
});

test('a card, size or language with no file is undefined, not an error', () => {
  const frames = loadTarotFrames(fixture(), () => {});
  assert.equal(frames.card('320x240', { id: 'major-00', reversed: false }, 'zh'), undefined);
  assert.equal(frames.card('320x240', { id: 'cups-09', reversed: false }, 'en'), undefined);
  assert.equal(frames.back('999x999'), undefined);
  assert.deepEqual(frames.shuffle('999x999'), []);
  assert.equal(frames.card('999x999', { id: 'major-00', reversed: false }, 'en'), undefined);
});

test('a missing directory says so once and leaves an empty set, so the screen stays blank', () => {
  /** @type {string[]} */ const lines = [];
  const frames = loadTarotFrames(join(tmpdir(), 'no-such-tarot-dir-xyz'), (l) => lines.push(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /tarot/);
  assert.deepEqual(frames.sizes, []);
  assert.equal(frames.back('320x240'), undefined);
  assert.equal(frames.shuffleCount, 0);
});

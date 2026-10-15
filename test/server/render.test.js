import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEarcon, renderEarcons, loadSfx } from '../../server/audio/render.js';
import { EARCONS, durationOf } from '../../core/audio/earcon.js';
import { SOUNDS } from '../../core/audio/sfx.js';

test('every earcon renders at 16 kHz for exactly its duration', () => {
  for (const name of EARCONS) {
    assert.equal(renderEarcon(name).length, durationOf(name) * 16, name);
  }
});

test('an earcon fades in from silence and peaks at the web gain of 0.25', () => {
  const pcm = renderEarcon('done');
  assert.equal(pcm[0], 0);
  const peak = pcm.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  assert.ok(peak > 7000 && peak <= 8192, `peak ${peak}`);
});

test('renderEarcons covers every name', () => {
  assert.deepEqual(Object.keys(renderEarcons()).sort(), [...EARCONS].sort());
});

test('every shipped sound loads and is not empty', () => {
  const sfx = loadSfx();
  for (const name of SOUNDS) assert.ok((sfx.get(name)?.length ?? 0) > 1600, name);
});

test('a missing directory loads nothing rather than throwing', () => {
  assert.equal(loadSfx('/nonexistent').size, 0);
});

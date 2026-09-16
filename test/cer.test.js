import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, editDistance, cer } from '../web/audio-bench/acoustics.js';

test('normalize drops punctuation, spaces and case', () => {
  // Punctuation comes and goes between STT backends and says nothing about the
  // audio. `turn left` and `turnleft` must not score as an error.
  assert.equal(normalize('Turn Left, 三米。'), 'turnleft三米');
});

test('normalize survives null and undefined rather than throwing', () => {
  // A failed STT call puts a string like "(STT failed: ...)" here, and an
  // aborted one can leave it unset. The verdict row must still render.
  assert.equal(normalize(/** @type {any} */ (null)), '');
  assert.equal(normalize(/** @type {any} */ (undefined)), '');
});

test('editDistance counts substitutions, insertions and deletions', () => {
  assert.equal(editDistance([...'abc'], [...'abc']), 0);
  assert.equal(editDistance([...'abc'], [...'abd']), 1);
  assert.equal(editDistance([...'abc'], [...'ab']), 1);
  assert.equal(editDistance([...'ab'], [...'abc']), 1);
});

test('cer is 0 when the transcript matches after normalising', () => {
  assert.equal(cer('往前走三米，然后 turn left', '往前走三米 然后turnleft'), 0);
});

test('cer counts Chinese by character', () => {
  // Two of four characters wrong is 0.5, and this is why the reference is
  // split with [...] rather than .split('') — a surrogate pair must count once.
  assert.equal(cer('往前走了', '往前跑步'), 0.5);
});

test('cer on an empty reference is null, not a division by zero', () => {
  assert.equal(cer('', 'anything'), null);
  assert.equal(cer('，。 ', 'anything'), null);
});

test('cer of an empty transcript against a real line is 1', () => {
  assert.equal(cer('往前走', ''), 1);
});

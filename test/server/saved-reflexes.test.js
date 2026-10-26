import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSavedReflexes, storedSavedReflexes, MAX_SAVED } from '../../server/saved-reflexes.js';
import { REFLEX_PRESETS } from '../../core/reflex-presets.js';
import { DEFAULT_STATE } from '../../core/config.js';

const QUESTION = REFLEX_PRESETS[1].question;
const SAVED = { name: 'Loose turns', threshold: 0.6, state: DEFAULT_STATE, question: QUESTION };

test('a saved reflex keeps its name, threshold, state and question, and nothing else', () => {
  assert.deepEqual(checkSavedReflexes([{ ...SAVED, apiKey: 'sk-1', extra: 1 }]), [SAVED]);
});

test('checkSavedReflexes refuses what the page should never send', () => {
  assert.throws(() => checkSavedReflexes({}), /must be a list/);
  assert.throws(() => checkSavedReflexes(['x']), /must be an object/);
  assert.throws(() => checkSavedReflexes([{ ...SAVED, name: '  ' }]), /name/);
  assert.throws(() => checkSavedReflexes([{ ...SAVED, name: 'x'.repeat(61) }]), /name/);
  assert.throws(() => checkSavedReflexes([SAVED, { ...SAVED }]), /twice/);
  assert.throws(() => checkSavedReflexes([{ ...SAVED, question: null }]), /question/);
  const many = Array.from({ length: MAX_SAVED + 1 }, (_, i) => ({ ...SAVED, name: `n${i}` }));
  assert.throws(() => checkSavedReflexes(many), /at most/);
});

test('checkSavedReflexes reads threshold and state the way the brain does', () => {
  const [s] = checkSavedReflexes([{ ...SAVED, threshold: 7, state: 'no placeholder' }]);
  assert.equal(s.threshold, 0.8);
  assert.equal(s.state, DEFAULT_STATE);
});

test('storedSavedReflexes drops a bad entry and keeps the rest', () => {
  assert.deepEqual(storedSavedReflexes([SAVED, { name: 'broken', question: 'x' }, 3]), [SAVED]);
  assert.deepEqual(storedSavedReflexes(undefined), []);
});

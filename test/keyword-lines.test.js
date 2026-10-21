import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  WAKE, parseTokens, unknownTokens, labelsIn, classifyLabel,
} from '../core/audio/keyword-lines.js';
import { MODEL_DIR, modelsPresent } from '../server/audio/sherpa-node.js';

const read = (/** @type {string} */ p) =>
  readFileSync(new URL(p, import.meta.url), 'utf8');
// The model's own symbol table, from the brain's model directory. Not in git
// (server/models/fetch.sh downloads it), so read inside each test that needs it.
const skip = modelsPresent() ? false : 'models missing — run server/models/fetch.sh';
const tokens = () => parseTokens(readFileSync(join(MODEL_DIR, 'tokens.txt'), 'utf8'));
const NAME = read('../core/keywords/name.txt');

test('the tokens file parses into the symbol table, not the indices', { skip }, () => {
  const TOKENS = tokens();
  // Each line is "<symbol> <id>"; only the symbol is what a keyword line may use.
  assert.ok(TOKENS.has('HH') && TOKENS.has('AY1') && TOKENS.has('ēi'));
  assert.ok(!TOKENS.has('0') && !TOKENS.has('263'));
});

test('EVERY token in the shipped keyword file exists in this model', { skip }, () => {
  const TOKENS = tokens();
  // Not a style check. An unknown token makes InitKeywords() call
  // SHERPA_ONNX_EXIT(-1), which aborts the whole wasm module — the page has to
  // be reloaded. This test is the only thing standing between a typo and that.
  assert.deepEqual(unknownTokens(NAME, TOKENS), []);
});

test('an unknown token is reported rather than ignored', { skip }, () => {
  const TOKENS = tokens();
  assert.deepEqual(unknownTokens('HH EY1 NOPE @x', TOKENS), ['NOPE']);
  // The old BPE spelling, which is what the part-1 plan carried as a
  // placeholder. It belongs to a different model and would abort this one.
  assert.deepEqual(unknownTokens('▁ste ven @x', TOKENS), ['▁ste', 'ven']);
});

test('flags are not tokens', { skip }, () => {
  const TOKENS = tokens();
  assert.deepEqual(unknownTokens('HH EY1 S T IY1 V AH0 N #0.15 :2.0 @hey_steven', TOKENS), []);
});

test('the name file carries the dual spelling spec §5.5 asks for', () => {
  assert.equal(NAME.trim().split('\n').length, 2);
});

test('the wake word rides the conservative global threshold (§5.5)', () => {
  assert.ok(!NAME.includes('#'));
});

test('every shipped label classifies — a renamed label must not fall silent', () => {
  for (const label of labelsIn(NAME)) assert.equal(classifyLabel(label), WAKE);
  assert.deepEqual(labelsIn(NAME), ['hey_steven', 'hey_steven_zh']);
  assert.equal(classifyLabel('something_else'), null);
});

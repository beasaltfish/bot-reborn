import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WAKE, STOP, parseTokens, unknownTokens, labelsIn, classifyLabel,
} from '../web/audio/keyword-lines.js';

const read = (/** @type {string} */ p) =>
  readFileSync(new URL(p, import.meta.url), 'utf8');
const TOKENS = parseTokens(read('../web/models/kws/tokens.txt'));
const NAME = read('../web/keywords/name.txt');
const STOP_FILE = read('../web/keywords/stop.txt');

test('the tokens file parses into the symbol table, not the indices', () => {
  // Each line is "<symbol> <id>"; only the symbol is what a keyword line may use.
  assert.ok(TOKENS.has('HH') && TOKENS.has('AY1') && TOKENS.has('ēi'));
  assert.ok(!TOKENS.has('0') && !TOKENS.has('263'));
});

test('EVERY token in the two shipped keyword files exists in this model', () => {
  // Not a style check. An unknown token makes InitKeywords() call
  // SHERPA_ONNX_EXIT(-1), which aborts the whole wasm module — the page has to
  // be reloaded. This test is the only thing standing between a typo and that.
  assert.deepEqual(unknownTokens(NAME, TOKENS), []);
  assert.deepEqual(unknownTokens(STOP_FILE, TOKENS), []);
});

test('an unknown token is reported rather than ignored', () => {
  assert.deepEqual(unknownTokens('HH EY1 NOPE @x', TOKENS), ['NOPE']);
  // The old BPE spelling, which is what the part-1 plan carried as a
  // placeholder. It belongs to a different model and would abort this one.
  assert.deepEqual(unknownTokens('▁ste ven @x', TOKENS), ['▁ste', 'ven']);
});

test('flags are not tokens', () => {
  assert.deepEqual(unknownTokens('AO1 L S T AA1 P #0.15 :2.0 @all_stop', TOKENS), []);
});

test('both files carry the dual spelling spec §5.5 asks for', () => {
  assert.equal(NAME.trim().split('\n').length, 2);
  assert.equal(STOP_FILE.trim().split('\n').length, 2);
});

test('the asymmetry is in the files, not in prose (§5.5)', () => {
  // The stop word gets a per-keyword threshold; the wake word rides the
  // conservative global default. Reversing these reverses which failure is safe:
  // a missed stop word means the car keeps going.
  assert.ok(STOP_FILE.includes('#0.15'));
  assert.ok(!NAME.includes('#'));
});

test('every shipped label classifies — a renamed label must not fall silent', () => {
  for (const label of labelsIn(NAME)) assert.equal(classifyLabel(label), WAKE);
  for (const label of labelsIn(STOP_FILE)) assert.equal(classifyLabel(label), STOP);
  assert.deepEqual(labelsIn(NAME), ['hey_steven', 'hey_steven_zh']);
  assert.deepEqual(labelsIn(STOP_FILE), ['all_stop', 'all_stop_zh']);
  assert.equal(classifyLabel('something_else'), null);
});

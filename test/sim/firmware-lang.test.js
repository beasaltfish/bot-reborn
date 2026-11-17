import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from '../../sim/firmware/lang/lexer.js';

test('tokenizes comments, strings and positions', () => {
  const tokens = tokenize('// hi\nint x = 1; /* ok */ Serial.println("a b");');
  assert.equal(tokens[0].value, 'int');
  assert.equal(tokens[0].kind, 'keyword');
  assert.equal(tokens[0].line, 2);
  assert.equal(tokens.find((t) => t.kind === 'string').value, 'a b');
  assert.equal(tokens.at(-1).kind, 'eof');
});

test('reports an unterminated string', () => {
  assert.throws(() => tokenize('Serial.println("oops);'), /unterminated string/);
});

test('recognizes multi-character operators and member access', () => {
  const values = tokenize('if (a == b && c != d) c = c + 1; Serial.println("x");').map((t) => t.value);
  assert.ok(values.includes('==') && values.includes('&&') && values.includes('!='));
  assert.ok(values.includes('.'));
});

test('tokenizes decimals and rejects unknown characters with a line', () => {
  assert.equal(tokenize('float x = 3.3;')[3].kind, 'number');
  assert.throws(() => tokenize('int x = 1;\n@'), /line 2/);
});

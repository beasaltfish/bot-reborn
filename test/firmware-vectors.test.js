// The messages the ESP32's parser is tested against (firmware/test/test_proto.c)
// must be judged the same way here first: core/protocol.js is the authority,
// and one file of cases keeps the two parsers from drifting apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../core/protocol.js';

/** @type {{ text: string, type: string | null }[]} */
const VECTORS = JSON.parse(readFileSync(new URL('../firmware/test/brain-messages.json', import.meta.url), 'utf8'));

test('every firmware vector is judged by core/protocol.js as the file says', () => {
  for (const v of VECTORS) {
    assert.equal(parse(v.text, 'brain')?.type ?? null, v.type, v.text);
  }
});

test('the screen\'s hello, as the firmware writes it, is a hello core/protocol.js accepts from a body', () => {
  const text = '{"type":"hello","protocol":2,"token":"0123456789abcdef0123456789abcdef","screen":{"w":320,"h":240}}';
  assert.equal(parse(text, 'body')?.type, 'hello');
});

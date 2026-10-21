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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, parse, PROTOCOL, MAX_MOVE_MS } from '../../web/protocol.js';
import * as motion from '../../web/motion.js';
import * as executor from '../../web/executor.js';

test('executor re-exports the motion constants unchanged', () => {
  assert.equal(executor.MAX_COAST_MS, motion.MAX_COAST_MS);
  assert.equal(executor.LEAD_MS, motion.LEAD_MS);
  assert.equal(executor.MIN_DURATION_MS, motion.MIN_DURATION_MS);
});

test('brain.js no longer reaches ftdi.js through executor.js', () => {
  const src = readFileSync(new URL('../../web/brain.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from '\.\/executor\.js'/);
});

test('a body hello round-trips', () => {
  const msg = { type: 'hello', protocol: PROTOCOL, token: 'ab'.repeat(16), caps: { motors: true, screen: false } };
  assert.deepEqual(parse(encode(msg), 'body'), msg);
});

test('a move without an end is refused', () => {
  assert.equal(parse(encode({ type: 'move', drive: 'forward', steer: 'left' }), 'brain'), null);
  assert.equal(parse(encode({ type: 'move', drive: 'forward', steer: 'left', ms: MAX_MOVE_MS + 1 }), 'brain'), null);
  assert.equal(parse(encode({ type: 'move', drive: 'forward', steer: 'left', ms: 0 }), 'brain'), null);
  assert.equal(parse(encode({ type: 'move', drive: 'forward', steer: 'left', ms: 2.5 }), 'brain'), null);
});

test('a well-formed move passes', () => {
  const msg = { type: 'move', drive: 'backward', steer: 'straight', ms: 600 };
  assert.deepEqual(parse(encode(msg), 'brain'), msg);
});

test('each side only accepts its own message types', () => {
  assert.equal(parse(encode({ type: 'welcome' }), 'body'), null);
  assert.equal(parse(encode({ type: 'hello', protocol: 1, caps: {} }), 'brain'), null);
  assert.deepEqual(parse(encode({ type: 'ping' }), 'body'), { type: 'ping' });
});

test('garbage is null, not a throw', () => {
  assert.equal(parse('not json', 'body'), null);
  assert.equal(parse('[]', 'body'), null);
  assert.equal(parse(encode({ type: 'motors' }), 'body'), null);
});

test('a hello without a token still parses, so the link can say why it is refused', () => {
  assert.notEqual(parse(encode({ type: 'hello', protocol: PROTOCOL, caps: {} }), 'body'), null);
});

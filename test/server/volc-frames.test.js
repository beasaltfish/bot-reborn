import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';

import { audioFrame, fullRequest, parseServerFrame } from '../../server/providers/volc-frames.js';

/**
 * A server full response as Volcengine sends it: gzip JSON, sequence present.
 * @param {number} flags @param {number} seq @param {unknown} payload @param {number} [headerWords]
 */
function serverFrame(flags, seq, payload, headerWords = 1) {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)));
  const header = Buffer.alloc(headerWords * 4);
  header[0] = 0x10 | headerWords;
  header[1] = (0b1001 << 4) | flags;
  header[2] = 0x11;
  const fixed = Buffer.alloc(8);
  fixed.writeInt32BE(seq, 0);
  fixed.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, fixed, body]);
}

/** An error frame: code, size, plain UTF-8 message. @param {number} code @param {string} message */
function errorFrame(code, message) {
  const body = Buffer.from(message);
  const fixed = Buffer.alloc(8);
  fixed.writeInt32BE(code, 0);
  fixed.writeUInt32BE(body.length, 4);
  return Buffer.concat([Buffer.from([0x11, 0xf0, 0x10, 0x00]), fixed, body]);
}

test('fullRequest: header 11 11 11 00, seq 1, size, gzip JSON', () => {
  const f = fullRequest({ a: 1 });
  assert.deepEqual([...f.subarray(0, 4)], [0x11, 0x11, 0x11, 0x00]);
  assert.equal(f.readInt32BE(4), 1);
  const size = f.readUInt32BE(8);
  assert.equal(f.length, 12 + size);
  assert.deepEqual(JSON.parse(gunzipSync(f.subarray(12)).toString()), { a: 1 });
});

test('audioFrame: audio-only type, raw+gzip, positive seq', () => {
  const f = audioFrame(2, Buffer.from([1, 2, 3, 4]), false);
  assert.deepEqual([...f.subarray(0, 4)], [0x11, 0x21, 0x01, 0x00]);
  assert.equal(f.readInt32BE(4), 2);
  assert.equal(f.readUInt32BE(8), f.length - 12);
  assert.deepEqual([...gunzipSync(f.subarray(12))], [1, 2, 3, 4]);
});

test('audioFrame last: flags 0b0011 and negated seq', () => {
  const f = audioFrame(5, Buffer.alloc(2), true);
  assert.equal(f[1], 0x23);
  assert.equal(f.readInt32BE(4), -5);
});

test('parseServerFrame reads a last full response with sequence', () => {
  assert.deepEqual(parseServerFrame(serverFrame(0b0011, -3, { result: { text: '往前走' } })),
    { type: 'response', last: true, sequence: -3, code: null, payload: { result: { text: '往前走' } } });
});

test('parseServerFrame reads a non-last response', () => {
  const r = parseServerFrame(serverFrame(0b0001, 2, { result: { text: '' } }));
  assert.equal(r.last, false);
  assert.equal(r.sequence, 2);
});

test('parseServerFrame honours a header longer than one word', () => {
  const r = parseServerFrame(serverFrame(0b0011, -2, { result: { text: 'x' } }, 2));
  assert.deepEqual(r.payload, { result: { text: 'x' } });
});

test('parseServerFrame reads an error frame code and message', () => {
  const r = parseServerFrame(errorFrame(45000001, 'invalid audio'));
  assert.equal(r.type, 'error');
  assert.equal(r.code, 45000001);
  assert.match(JSON.stringify(r.payload), /invalid audio/);
});

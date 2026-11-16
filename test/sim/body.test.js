import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeUplink, shapeDownlink, faultText, adminLink, keepsFault } from '../../sim/body.js';

const pcm = Int16Array.from([0, 1000, -1000, 32767, -32768]);
const bytesOf = (/** @type {Int16Array} */ a) => /** @type {ArrayBuffer} */ (a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));

test('uplink: ok passes the samples through unchanged', () => {
  assert.deepEqual(shapeUplink(pcm, 'ok'), pcm);
});

test('uplink: silent is zeros of the same length', () => {
  const out = shapeUplink(pcm, 'silent');
  assert.equal(out.length, pcm.length);
  assert.ok(out.every((s) => s === 0));
});

test('uplink: noise is loud, same length, and not the input', () => {
  const big = new Int16Array(1600);
  const out = shapeUplink(big, 'noise');
  assert.equal(out.length, big.length);
  assert.ok(out.some((s) => Math.abs(s) > 16000));
});

test('downlink: ok is the same bytes', () => {
  assert.deepEqual(new Int16Array(/** @type {ArrayBuffer} */ (shapeDownlink(bytesOf(pcm), 'ok'))), pcm);
});

test('downlink: quiet halves every sample', () => {
  const out = new Int16Array(/** @type {ArrayBuffer} */ (shapeDownlink(bytesOf(pcm), 'quiet')));
  assert.deepEqual([...out], [0, 500, -500, 16383, -16384]);
});

test('downlink: silent plays nothing', () => {
  assert.equal(shapeDownlink(bytesOf(pcm), 'silent'), null);
});

test('faultText: says what to check, in plain words', () => {
  const tail = ' — check it on the admin page';
  assert.equal(faultText({ part: 'llm', status: 401, kind: 'http' }), `LLM key rejected (401)${tail}`);
  assert.equal(faultText({ part: 'stt', status: 429, kind: 'http' }), `STT is out of quota or rate-limited (429)${tail}`);
  assert.equal(faultText({ part: 'tts', status: null, kind: 'timeout' }), 'TTS could not be reached — check its address on the admin page');
});

test('adminLink: escapes the id', () => {
  assert.equal(adminLink('a b'), '/#character=a%20b');
});

test('keepsFault: only the user speaking again clears a fault', () => {
  assert.equal(keepsFault('SPEAKING'), true);
  assert.equal(keepsFault('CAPTURING'), false);
});

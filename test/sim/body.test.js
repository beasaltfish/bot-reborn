import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeUplink, shapeDownlink, characterChoices, faultText, adminLink } from '../../sim/body.js';

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

test('downlink: noise keeps the length', () => {
  const out = /** @type {ArrayBuffer} */ (shapeDownlink(new ArrayBuffer(3200), 'noise'));
  assert.equal(out.byteLength, 3200);
  assert.ok(new Int16Array(out).some((s) => Math.abs(s) > 16000));
});

test('choices: free ones first, then busy, then unset, each with its note', () => {
  const out = characterChoices([
    { id: 'a', name: 'A', ready: false, online: false },
    { id: 'b', name: 'B', ready: true, online: true },
    { id: 'c', name: 'C', ready: true, online: false },
  ]);
  assert.deepEqual(out, [
    { id: 'c', name: 'C', note: null },
    { id: 'b', name: 'B', note: 'In use by another body' },
    { id: 'a', name: 'A', note: 'Not set up — open the admin page' },
  ]);
});

test('choices: nothing in, nothing out', () => {
  assert.deepEqual(characterChoices([]), []);
});

test('faultText: says what to check, in plain words', () => {
  const tail = ' — check it on the admin page';
  assert.equal(faultText({ part: 'llm', status: 401, kind: 'http' }), `LLM key rejected (401)${tail}`);
  assert.equal(faultText({ part: 'llm', status: 403, kind: 'http' }), `LLM key rejected (403)${tail}`);
  assert.equal(faultText({ part: 'stt', status: 429, kind: 'http' }), `STT is out of quota or rate-limited (429)${tail}`);
  const gone = 'TTS could not be reached — check its address on the admin page';
  assert.equal(faultText({ part: 'tts', status: null, kind: 'timeout' }), gone);
  assert.equal(faultText({ part: 'tts', status: null, kind: 'network' }), gone);
  assert.equal(faultText({ part: 'llm', status: 500, kind: 'http' }), 'LLM failed (HTTP 500)');
  assert.equal(faultText({ part: 'llm', status: null, kind: 'other' }), 'LLM failed');
});

test('adminLink: escapes the id', () => {
  assert.equal(adminLink('a b'), '/#character=a%20b');
});

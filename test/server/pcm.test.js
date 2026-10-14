import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToFloat32, int16ToBytes, isWav, parseWav, resample } from '../../server/audio/pcm.js';
import { encodeWav } from '../../web/providers/stt-openai-compat.js';

test('int16 bytes round-trip little-endian', () => {
  const pcm = Int16Array.from([0, 16384, -16384, 32767, -32768]);
  const bytes = int16ToBytes(pcm);
  assert.deepEqual([...bytes.slice(0, 4)], [0, 0, 0x00, 0x40]);
  const back = bytesToFloat32(bytes);
  assert.deepEqual([...back].map((x) => Math.round(x * 32768)), [...pcm]);
});

test('an odd trailing byte is dropped, not misread', () => {
  assert.equal(bytesToFloat32(new Uint8Array(5)).length, 2);
});

test('bytesToFloat32 honours a view into a larger buffer', () => {
  const big = new Uint8Array([9, 9, 0x00, 0x40, 9]);
  assert.deepEqual([...bytesToFloat32(big.subarray(2, 4))], [0.5]);
});

test('a 16-bit mono WAV parses to its samples and rate', () => {
  const bytes = new Uint8Array(encodeWav(Int16Array.from([0, 16384, -16384]), 24000));
  assert.equal(isWav(bytes), true);
  const { rate, samples } = parseWav(bytes);
  assert.equal(rate, 24000);
  assert.deepEqual([...samples], [0, 0.5, -0.5]);
});

test('a streamed WAV whose data size is 0xFFFFFFFF reads to the end', () => {
  const bytes = new Uint8Array(encodeWav(Int16Array.from([100, 200, 300]), 16000));
  new DataView(bytes.buffer).setUint32(40, 0xFFFFFFFF, true);
  assert.equal(parseWav(bytes).samples.length, 3);
});

test('stereo is averaged to mono', () => {
  // Build a stereo header by hand: L = 0.5, R = 0 → 0.25
  const bytes = new Uint8Array(encodeWav(Int16Array.from([16384, 0, 16384, 0]), 16000));
  const v = new DataView(bytes.buffer);
  v.setUint16(22, 2, true);          // channels
  v.setUint16(32, 4, true);          // block align
  const { samples } = parseWav(bytes);
  assert.deepEqual([...samples], [0.25, 0.25]);
});

test('MP3 bytes are not WAV', () => {
  const mp3 = new TextEncoder().encode('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000rest');
  assert.equal(isWav(mp3), false);
  assert.throws(() => parseWav(mp3), /not a WAV file/);
});

test('resample changes the length by the rate ratio and keeps a constant', () => {
  const out = resample(new Float32Array(2400).fill(0.5), 24000, 16000);
  assert.equal(out.length, 1600);
  assert.ok(out.every((x) => Math.abs(x - 0.5) < 1e-6));
  const same = new Float32Array([1, 2]);
  assert.equal(resample(same, 16000, 16000), same);
});

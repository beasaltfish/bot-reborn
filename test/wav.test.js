import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../web/audio/wav.js';

/** @param {ArrayBuffer} buf @param {number} off */
const ascii = (buf, off) =>
  String.fromCharCode(...new Uint8Array(buf, off, 4));

test('the header declares 16-bit mono PCM at the sample rate it was given', () => {
  const view = new DataView(encodeWav(new Int16Array([1, 2, 3]), 16000));
  assert.equal(view.getUint16(20, true), 1, 'audioFormat 1 = uncompressed PCM');
  assert.equal(view.getUint16(22, true), 1, 'one channel');
  assert.equal(view.getUint32(24, true), 16000, 'sample rate');
  assert.equal(view.getUint32(28, true), 32000, 'byteRate = rate × 2 bytes');
  assert.equal(view.getUint16(32, true), 2, 'blockAlign');
  assert.equal(view.getUint16(34, true), 16, 'bitsPerSample');
});

test('the samples survive the trip, in order and little-endian', () => {
  // Negative and full-scale values on purpose: a sign or endianness mistake
  // shows up here and nowhere in the length checks.
  const pcm = new Int16Array([0, -1, 32767, -32768]);
  const buf = encodeWav(pcm, 16000);
  assert.equal(buf.byteLength, 44 + pcm.length * 2);
  assert.deepEqual([...new Int16Array(buf, 44)], [...pcm]);
});

test('both chunk sizes count their own payload, not the whole file', () => {
  // The classic WAV bug is an off-by-8 here. decodeAudioData does not reject a
  // wrong RIFF size — it trusts it and hands back a truncated buffer, so the
  // clip loses its tail and the STT result looks like a bad recording.
  const buf = encodeWav(new Int16Array(10), 16000);
  const view = new DataView(buf);
  assert.equal(ascii(buf, 0), 'RIFF');
  assert.equal(ascii(buf, 8), 'WAVE');
  assert.equal(ascii(buf, 12), 'fmt ');
  assert.equal(ascii(buf, 36), 'data');
  assert.equal(view.getUint32(4, true), buf.byteLength - 8, 'RIFF size skips "RIFF" and itself');
  assert.equal(view.getUint32(40, true), 20, 'data size is the samples alone');
});

test('an empty recording still produces a valid, empty WAV', () => {
  // The recorder can hand over nothing at all if the mic delivered no frame.
  // A 44-byte header is a file that decodes to silence; a zero-byte one is a
  // decode error that reads like a broken provider.
  const buf = encodeWav(new Int16Array(0), 16000);
  assert.equal(buf.byteLength, 44);
  assert.equal(new DataView(buf).getUint32(40, true), 0);
});

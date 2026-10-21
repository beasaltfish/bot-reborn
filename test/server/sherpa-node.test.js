import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODEL_DIR, modelsPresent, loadSherpaNode, loadKeywords, createSpotter, createVoiceDetector,
} from '../../server/audio/sherpa-node.js';
import { parseWav } from '../../server/audio/pcm.js';

const skip = modelsPresent() ? false : 'models missing — run server/models/fetch.sh';

test('the shipped keyword lines all use known tokens', { skip }, () => {
  assert.match(loadKeywords(), /@hey_steven/);
});

test('the spotter hears nothing in silence', { skip }, () => {
  const kws = createSpotter(loadSherpaNode(), loadKeywords());
  let hits = 0;
  for (let i = 0; i < 20; i++) hits += kws.accept(new Float32Array(1600)).length;
  assert.equal(hits, 0);
});

test('the VAD cuts the English check clip into at least one segment', { skip }, () => {
  const vad = createVoiceDetector(loadSherpaNode());
  const { samples } = parseWav(new Uint8Array(
    readFileSync(new URL('../../core/fixtures/check-en.wav', import.meta.url))));
  const padded = new Float32Array(samples.length + 32000);
  padded.set(samples);
  /** @type {Float32Array[]} */ const segs = [];
  for (let i = 0; i < padded.length; i += 1600) {
    vad.accept(padded.subarray(i, i + 1600));
    segs.push(...vad.drain());
  }
  assert.ok(segs.length >= 1);
  assert.ok(segs[0].length > 8000, `segment of ${segs[0].length} samples`);
  // Copied out of the engine: still intact after more audio went in.
  vad.accept(new Float32Array(16000));
  assert.ok(segs[0].some((x) => x !== 0));
});

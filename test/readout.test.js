import test from 'node:test';
import assert from 'node:assert/strict';
import { rms, dbOf, fmt, dbs } from '../web/audio-bench/readout.js';

test('rms of silence is zero', () => {
  assert.equal(rms(new Float32Array(160)), 0);
});

test('rms of full-scale DC is one', () => {
  assert.equal(rms(new Float32Array(160).fill(1)), 1);
});

test('rms of a square wave is its amplitude, sign-independent', () => {
  const f = new Float32Array([0.5, -0.5, 0.5, -0.5]);
  assert.ok(Math.abs(rms(f) - 0.5) < 1e-12);
});

test('dbOf(1) is 0 dBFS', () => {
  assert.equal(dbOf(1), 0);
});

test('dbOf(0.5) is about −6 dB', () => {
  assert.ok(Math.abs(dbOf(0.5) + 6.02) < 0.01);
});

test('dbOf(0) floors at −120 rather than −Infinity', () => {
  // A silent window is normal — the noise-floor window is supposed to be
  // quiet. −Infinity propagates through every later subtraction and turns the
  // whole verdict row into NaN, which reads as a broken page rather than as a
  // quiet room.
  assert.equal(dbOf(0), -120);
});

test('dbOf of a negative amplitude also floors, instead of returning NaN', () => {
  assert.equal(dbOf(-0.1), -120);
});

test('dbs renders silence as −∞ and everything else as a rounded dB', () => {
  assert.equal(dbs(0), '−∞');
  assert.equal(dbs(1), '0 dB');
});

test('fmt keeps a fixed number of decimals so columns line up', () => {
  assert.equal(fmt(8.5478, 2), '8.55');
  assert.equal(fmt(19, 1), '19.0');
  assert.equal(fmt(0.5), '0.5');
});

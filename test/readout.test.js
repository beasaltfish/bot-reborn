import test from 'node:test';
import assert from 'node:assert/strict';
import { rms, dbOf, fmt, dbs, createMeter } from '../web/audio-bench/readout.js';

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

test('an empty meter reads zero, not NaN', () => {
  // "no frames yet" is the normal state of every panel before Run is pressed,
  // and 0/0 would put NaN into the stat row for the whole first second.
  const m = createMeter();
  assert.equal(m.count, 0);
  assert.equal(m.mean, 0);
  assert.equal(m.max, 0);
});

test('mean is the running average and max is the peak', () => {
  const m = createMeter();
  m.add(2); m.add(4); m.add(9);
  assert.equal(m.count, 3);
  assert.equal(m.mean, 5);
  assert.equal(m.max, 9);
});

test('reset empties it back to the zero state, not to NaN', () => {
  const m = createMeter();
  m.add(7);
  m.reset();
  assert.equal(m.count, 0);
  assert.equal(m.mean, 0);
  assert.equal(m.max, 0);
});

test('a zero sample counts as a sample', () => {
  // A frame that cost 0.0 ms is a measurement, not a missing one — dropping it
  // would bias every per-frame average upward.
  const m = createMeter();
  m.add(0);
  assert.equal(m.count, 1);
  assert.equal(m.mean, 0);
});

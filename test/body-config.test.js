import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_KEY, defaultConfig, loadConfig, saveConfig, tokenFromHash, directionsTaught,
} from '../phone/config.js';

function memory() {
  /** @type {Map<string, string>} */ const m = new Map();
  return { getItem: (/** @type {string} */ k) => m.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { m.set(k, v); }, m };
}

test('a phone out of the box knows nothing: no brain, no car', () => {
  assert.deepEqual(defaultConfig(), {
    lang: 'en', token: null,
    calibration: { steerSwapped: null, driveSwapped: null, bytesPerMs: null },
  });
});

test('what is saved comes back, under its own key', () => {
  const s = memory();
  const cfg = defaultConfig();
  cfg.token = 'ab'.repeat(16);
  cfg.calibration.steerSwapped = false;
  saveConfig(cfg, s);
  assert.ok(s.m.has(CONFIG_KEY));
  assert.deepEqual(loadConfig(s), cfg);
});

test('a stored false survives loading: it is a measurement, not a missing value', () => {
  const s = memory();
  s.setItem(CONFIG_KEY, JSON.stringify({ calibration: { driveSwapped: false } }));
  const cfg = loadConfig(s);
  assert.equal(cfg.calibration.driveSwapped, false);
  assert.equal(cfg.calibration.steerSwapped, null);
});

test('garbage in storage is a fresh phone, not a crash', () => {
  const s = memory();
  s.setItem(CONFIG_KEY, '{nope');
  assert.deepEqual(loadConfig(s), defaultConfig());
});

test('the QR code\'s token is read from the fragment, and nothing else is', () => {
  const tok = '0123456789abcdef'.repeat(2);
  assert.equal(tokenFromHash(`#token=${tok}`), tok);
  assert.equal(tokenFromHash(`#x=1&token=${tok}`), tok);
  assert.equal(tokenFromHash(''), null);
  assert.equal(tokenFromHash('#token=short'), null);
  assert.equal(tokenFromHash(`#token=${tok.toUpperCase()}`), null);
  assert.equal(tokenFromHash(`#token=${tok}0`), null);
});

test('directions are taught only when both questions were answered', () => {
  assert.equal(directionsTaught({ steerSwapped: null, driveSwapped: null, bytesPerMs: null }), false);
  assert.equal(directionsTaught({ steerSwapped: true, driveSwapped: null, bytesPerMs: null }), false);
  assert.equal(directionsTaught({ steerSwapped: false, driveSwapped: false, bytesPerMs: null }), true);
});

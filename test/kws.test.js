import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpotter } from '../web/audio/kws.js';

/** Captures the config createSpotter hands to createKws. */
function spy() {
  /** @type {any} */ let seen = null;
  const sherpa = {
    Module: {},
    createKws: (/** @type {any} */ _m, /** @type {any} */ cfg) => {
      seen = cfg;
      return {
        createStream: () => ({ acceptWaveform() {} }),
        isReady: () => false,
        decode() {}, getResult: () => ({ keyword: '' }), reset() {},
      };
    },
  };
  return { sherpa, config: () => seen };
}

test('the product defaults are what an unparameterised call still gets', () => {
  const s = spy();
  createSpotter(s.sherpa, 'HH EY  @hey');
  assert.equal(s.config().keywordsScore, 1.0);
  assert.equal(s.config().keywordsThreshold, 0.25);
});

test('both thresholds can be overridden — this is what ⑦ sweeps', () => {
  const s = spy();
  createSpotter(s.sherpa, 'HH EY  @hey', { score: 2.5, threshold: 0.4 });
  assert.equal(s.config().keywordsScore, 2.5);
  assert.equal(s.config().keywordsThreshold, 0.4);
});

test('overriding one leaves the other at its default', () => {
  const s = spy();
  createSpotter(s.sherpa, 'HH EY  @hey', { threshold: 0.1 });
  assert.equal(s.config().keywordsThreshold, 0.1);
  assert.equal(s.config().keywordsScore, 1.0);
});

test('a threshold of 0 is honoured, not treated as absent', () => {
  // `??`, never `||`: 0 is a legitimate sweep value and `||` would silently
  // promote it back to 0.25 — the same trap config.js documents for bargeIn.
  const s = spy();
  createSpotter(s.sherpa, 'HH EY  @hey', { threshold: 0, score: 0 });
  assert.equal(s.config().keywordsThreshold, 0);
  assert.equal(s.config().keywordsScore, 0);
});

test('the keyword lines still reach the engine unchanged', () => {
  const s = spy();
  createSpotter(s.sherpa, 'HH EY  S T IY V AH N  @hey steven');
  assert.equal(s.config().keywords, 'HH EY  S T IY V AH N  @hey steven');
});

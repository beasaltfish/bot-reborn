import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL, materialFor } from '../web/instrument-material.js';

test('both arms carry every field an instrument reads', () => {
  for (const lang of /** @type {const} */ (['en', 'zh'])) {
    const m = MATERIAL[lang];
    for (const key of /** @type {const} */ (['script', 'readLine', 'ttsLine', 'runOn'])) {
      assert.equal(typeof m[key], 'string', `${lang}.${key}`);
      assert.ok(m[key].length > 0, `${lang}.${key} is empty`);
    }
    assert.ok(Array.isArray(m.commands) && m.commands.length >= 2,
      `${lang}.commands needs at least two`);
    assert.equal(m.fixtures.length, 3, `${lang}.fixtures must be exactly three`);
  }
});

test('the passage is long enough to walk all five windows', () => {
  // acoustics.js spends 1.5 + 8 + 8 + 3 = 20.5 s reading it and ABORTS the run
  // if the voice stops mid-window. Longer is free — the run cancels playback at
  // the end — so these floors are deliberately generous.
  assert.ok([...MATERIAL.zh.script].length >= 150,
    'the zh passage is under ~23 s of speech');
  assert.ok(MATERIAL.en.script.split(/\s+/).length >= 70,
    'the en passage is under ~23 s of speech');
});

test('every ⑯ command starts with a consonant', () => {
  // ⑯ measures whether the head of the utterance survives. A command opening on
  // a vowel cannot show a lost onset, so it cannot fail the test it is for.
  const VOWEL = /^[aeiou]/i;
  for (const c of MATERIAL.en.commands) {
    assert.ok(!VOWEL.test(c), `"${c}" opens on a vowel`);
  }
  assert.ok(MATERIAL.en.runOn.startsWith('hey steven '));
  assert.ok(MATERIAL.zh.runOn.startsWith('hey steven '));
});

test('the zh arm is code-switched and the en arm is not', () => {
  // The whole reason there are two arms. §9.3's "hardest case" is a claim about
  // this user's input, not a difficulty dial: for an English-only speaker the
  // mixed line tests a capability they do not need and can fail a provider that
  // serves them fine.
  const HAN = /\p{Script=Han}/u;
  assert.ok(HAN.test(MATERIAL.zh.ttsLine));
  assert.ok(/[a-z]/i.test(MATERIAL.zh.ttsLine), 'the zh line must mix, not be pure Chinese');
  assert.ok(!HAN.test(MATERIAL.en.ttsLine));
  assert.ok(!HAN.test(MATERIAL.en.script));
  assert.ok(!HAN.test(MATERIAL.en.readLine));
});

test('fixture paths are unique across both arms', () => {
  // They key a Cache in fixture-store.js. Two arms sharing a path means
  // recording the English one overwrites the Chinese one, silently.
  const all = [...MATERIAL.en.fixtures, ...MATERIAL.zh.fixtures].map((f) => f.path);
  assert.equal(new Set(all).size, all.length);
});

test('an unknown language falls back to English, not to undefined', () => {
  // config.lang is typed 'en' | 'zh', but this is read from localStorage and a
  // stored config from a future version can carry anything.
  assert.equal(materialFor('de'), MATERIAL.en);
  assert.equal(materialFor('zh'), MATERIAL.zh);
});

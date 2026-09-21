import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Han, kana and hangul. NOT 「」 — those are U+300C/U+300D in CJK Symbols and
// Punctuation, script Common, and this file uses them as quote marks in
// English prose (so does providers.js's loggedTts). Banning the brackets would
// ban quoting, which is not what the rule is about.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// Every instrument source. The product (index.html, app.js, strings.js …) is
// not here: it is translated, and strings.js's zh table IS the locale.
const INSTRUMENTS = [
  'web/dev.html', 'web/dev.js',
  'web/panels/pins.js', 'web/panels/connectivity.js',
  'web/panels/acoustics.js', 'web/panels/knobs.js',
  'web/dev.js', 'web/panels/providers.js',
  'web/panels/readout.js', 'web/panels/recognition.js',
  'web/panels/residency.js', 'web/panels/samples.js',
];

// The ratchet. Each entry is a file that still has Chinese in it and the task
// that takes it off this list. Shrink it; never grow it. When it is empty this
// test becomes the plain rule and stays that way.
/** @type {Set<string>} */
const ALLOWED = new Set();

/** @param {string} rel */
const read = (rel) =>
  readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

test('no instrument source carries Chinese of its own', () => {
  for (const rel of INSTRUMENTS) {
    if (ALLOWED.has(rel)) continue;
    const lines = read(rel).split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => CJK.test(String(line)));
    assert.deepEqual(lines, [],
      `${rel} carries Chinese — it belongs in web/instrument-material.js or in docs/`);
  }
});

test('the allow-list is empty, and stays that way', () => {
  // Every entry has been retired. Adding one back needs a reason in the commit
  // message: an instrument carries no Chinese of its own, and
  // web/instrument-material.js is the single exemption.
  //
  // This replaced a test that walked ALLOWED checking each entry was still
  // dirty. Against an empty set that test passes vacuously — it would have gone
  // on passing while somebody quietly re-added an exemption.
  assert.equal(ALLOWED.size, 0);
});

test('the material table is the one place Chinese is allowed', () => {
  // Not on INSTRUMENTS, and deliberately asserted the other way round: if this
  // file ever stops carrying Chinese, the zh arm has been translated away and
  // ⑩ ⑪ stopped measuring code-switching without anything else going red.
  assert.ok(CJK.test(read('web/instrument-material.js')),
    'web/instrument-material.js has no Chinese left — the zh arm was translated away');
});

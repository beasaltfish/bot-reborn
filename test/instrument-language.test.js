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
  'web/bench.html', 'web/bench.js',
  'web/setup.html', 'web/setup.js',
  'web/audio-bench.html',
  'web/audio-bench/acoustics.js', 'web/audio-bench/knobs.js',
  'web/audio-bench/main.js', 'web/audio-bench/providers.js',
  'web/audio-bench/readout.js', 'web/audio-bench/recognition.js',
  'web/audio-bench/residency.js', 'web/audio-bench/samples.js',
];

// The ratchet. Each entry is a file that still has Chinese in it and the task
// that takes it off this list. Shrink it; never grow it. When it is empty this
// test becomes the plain rule and stays that way.
const ALLOWED = new Set([
  'web/audio-bench/acoustics.js',   // Task 3
  'web/audio-bench/providers.js',   // Task 4
  'web/audio-bench/recognition.js', // Task 5
  'web/audio-bench/main.js',        // Task 5
  'web/setup.js',                   // Task 6
  'web/setup.html',                 // Task 6
  'web/audio-bench.html',           // Task 7
]);

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

test('the allow-list only ever shrinks', () => {
  // A file on the list that is already clean means somebody finished the work
  // and left the exemption behind — the next person to add Chinese there would
  // get no warning at all.
  for (const rel of ALLOWED) {
    assert.ok(CJK.test(read(rel)),
      `${rel} is clean now — take it off ALLOWED instead of leaving a dead exemption`);
  }
});

test('the material table is the one place Chinese is allowed',
  { skip: 'web/instrument-material.js lands in Task 2' }, () => {
  // Not on INSTRUMENTS, and deliberately asserted the other way round: if this
  // file ever stops carrying Chinese, the zh arm has been translated away and
  // ⑩ ⑪ stopped measuring code-switching without anything else going red.
  assert.ok(CJK.test(read('web/instrument-material.js')),
    'web/instrument-material.js has no Chinese left — the zh arm was translated away');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGES } from '../web/instrument-status.js';

/** @param {string} rel */
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const productCss = read('web/style.css');
const instrumentCss = read('web/instrument.css');

/** @param {string} css @param {string} name */
function token(css, name) {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

test('the four colour meanings have the same value in both stylesheets', () => {
  // docs/ui.md fixes four meanings and reserves red for the emergency stop. The
  // instruments deliberately do not look like the product (spec §1), but the
  // same green must not mean two different things across two pages of one
  // project. Two definitions rather than a third shared file: the split is
  // deliberate, and this test is cheaper than the dependency.
  for (const name of ['go', 'wait', 'stop', 'ink']) {
    const a = token(productCss, name);
    const b = token(instrumentCss, name);
    assert.ok(a, `style.css does not define --${name}`);
    assert.equal(b, a, `--${name} differs between the two stylesheets`);
  }
});

test('the instruments are left-aligned by default', () => {
  // This one line was the source of every fight: forms, readings and
  // instructions all want the left edge, so four separate rules existed only to
  // undo it. Centring is what these pages inherited on day one, not a decision
  // anybody made.
  assert.ok(!/body\s*\{[^}]*text-align:\s*center/s.test(instrumentCss),
    'instrument.css still centres body');
});

test('no red that is not the emergency stop', () => {
  // Red is reserved (docs/ui.md): the button that must be found instantly stops
  // being findable the moment it is one of several red things — and two of
  // these pages have a real emergency stop next to a car that really moves.
  const reds = [...instrumentCss.matchAll(/#(?:c62828|e53935|d32f2f|f44336|ff0000|e00|f00)\b/gi)];
  assert.deepEqual(reds.map((m) => m[0]), [],
    'instrument.css hard-codes a red; use var(--stop), and only for the emergency stop');
});

const PAGES_SRC = /** @type {[string, string, number][]} */ ([
  ['bench.html', read('web/bench.html'), 5],
  ['setup.html', read('web/setup.html'), 5],
  ['audio-bench.html', read('web/audio-bench.html'), 8],
]);

test('no instrument page still separates its sections with a rule', () => {
  // <hr> says "the thing above ended". A card says "these belong together",
  // which is the question somebody scrolling actually has.
  for (const [name, source] of PAGES_SRC) {
    assert.ok(!/<hr\s*\/?>/.test(source), `${name} still uses <hr>`);
  }
});

test('every page carries exactly the cards the spec lists', () => {
  for (const [name, source, count] of PAGES_SRC) {
    const cards = [...source.matchAll(/<section class="card"/g)];
    assert.equal(cards.length, count, `${name} has ${cards.length} cards, expected ${count}`);
  }
});

test('a card is a header, then what you do, then what came back', () => {
  // The order is the whole answer to "I do not know what to look at first": the
  // third block is always the result and the second is always the controls, in
  // all eighteen cards on all three pages. A card may omit the readings (some
  // have none) but may not reorder.
  for (const [name, source] of PAGES_SRC) {
    for (const card of source.split('<section class="card"').slice(1)) {
      const body = card.slice(0, card.indexOf('</section>'));
      assert.ok(/<header\b/.test(body), `a card in ${name} has no <header>`);
      const doAt = body.indexOf('class="card-do"');
      const readAt = body.indexOf('class="card-read"');
      assert.ok(doAt >= 0, `a card in ${name} has no .card-do`);
      if (readAt >= 0) {
        assert.ok(readAt > doAt, `a card in ${name} puts its readings before its controls`);
      }
    }
  }
});

test('the status strip knows all three instruments and nothing else', () => {
  // The three pages cannot reach each other today: the only route is back to
  // index.html and in through the gear, or typing a URL on a phone.
  assert.deepEqual(PAGES.map((p) => p.href).sort(),
    ['audio-bench.html', 'bench.html', 'setup.html']);
  for (const p of PAGES) {
    assert.ok(p.label.length > 0 && p.label.length <= 12,
      `"${p.label}" does not fit on one line of a phone`);
  }
});

test('every instrument page mounts the strip', () => {
  for (const [name, source] of PAGES_SRC) {
    assert.match(source, /id="instrumentStatus"/, `${name} does not mount the status strip`);
  }
});

test('red is the emergency stop and nothing else', () => {
  // docs/ui.md: the button that must be found instantly stops being findable
  // the moment it is one of several red things. Two of these pages have a real
  // emergency stop; the third makes the car circle with no stop at all, which
  // is what #benchbarStop is for.
  const allowed = /** @type {Record<string, string[]>} */ ({
    'bench.html': ['stopBtn'],
    'setup.html': ['stopBtn'],
    'audio-bench.html': ['benchbarStop'],
  });
  for (const [name, source] of PAGES_SRC) {
    const reds = [...source.matchAll(/<button[^>]*\bdanger\b[^>]*>/g)]
      .map((m) => (m[0].match(/id="([^"]+)"/) ?? [])[1]);
    assert.deepEqual(reds.sort(), allowed[name].sort(),
      `${name} paints something red that is not its emergency stop`);
  }
});

test('the audio bench has an emergency stop at all', () => {
  // cruise() renews itself and never resolves. Before this existed, the only
  // way to stop the car was to scroll back up to the button that started it.
  const [, source] = /** @type {[string, string, number]} */ (
    PAGES_SRC.find(([n]) => n === 'audio-bench.html'));
  assert.match(source, /id="benchbarStop"/);
});

test('the connectivity test knows no provider the preset list does not', () => {
  // The two surfaces that configure the three layers must agree on what exists.
  // They deliberately look nothing alike — the product's sheet is "pick a
  // provider, type only the key", this page is "every field editable at once",
  // which is what ⑪ needs — but looking different is not licence to know
  // different things.
  //
  // What this caught: setup.html suggested `deepseek-flash`, a model name that
  // appears nowhere else in the repo. A model an ordinary key cannot reach
  // answers 404 "no such model", which on a page about connectivity reads as a
  // bad key — the exact failure provider-presets.js exists to prevent.
  const [, source] = /** @type {[string, string, number]} */ (
    PAGES_SRC.find(([n]) => n === 'setup.html'));
  const providerish = [...source.matchAll(/placeholder="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((v) => /^https?:\/\//.test(v) || /^[a-z0-9]+[-/][a-z0-9.\-/]+$/i.test(v));
  assert.deepEqual(providerish, [],
    'setup.html hard-codes a provider endpoint or model; build it from PRESETS');
});

test('every provider layer can be saved and tested where it is typed', () => {
  // A card is one question: fill it in, keep it, try it, read the answer. The
  // page used to have one Save and one block of four tests, two cards away from
  // the fields they were about — which is the "the readings are a screen from
  // the control" complaint wearing a different hat. assertFilled's own error
  // message used to end "under Configuration above first", pointing up the page.
  const [, source] = /** @type {[string, string, number]} */ (
    PAGES_SRC.find(([n]) => n === 'setup.html'));
  for (const layer of ['stt', 'llm', 'tts']) {
    assert.match(source, new RegExp(`data-save="${layer}"`), `no Save for ${layer}`);
    assert.match(source, new RegExp(`data-test="${layer}"`), `no Test for ${layer}`);
  }
  assert.match(source, /data-test="usb"/);
});

test('every id the instruments reach for exists in their markup', () => {
  // The same contract markup.test.js holds for index.html, which the two bench
  // pages never had: a typo here is a blank page at runtime with nothing in the
  // console but "null is not an object", and no other test would notice.
  //
  // Derived rather than listed, so it cannot go stale: every `el('x')` and
  // `$('x')` in a page's own modules has to name something in that page.
  const SOURCES = /** @type {[string, string[]][]} */ ([
    ['web/setup.html', ['web/setup.js']],
    ['web/bench.html', ['web/bench.js']],
    ['web/audio-bench.html', [
      'web/audio-bench/main.js', 'web/audio-bench/knobs.js',
      'web/audio-bench/residency.js', 'web/audio-bench/acoustics.js',
      'web/audio-bench/recognition.js', 'web/audio-bench/providers.js',
    ]],
  ]);
  for (const [page, modules] of SOURCES) {
    const html = read(page);
    for (const module of modules) {
      const js = read(module);
      const ids = new Set([...js.matchAll(/\b(?:el|\$|setStat|setDisabled)\(\s*'([A-Za-z][\w-]*)'/g)]
        .map((m) => m[1]));
      for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`),
          `${module} reaches for #${id}, which ${page} does not have`);
      }
    }
  }
});

test('nothing in the config form can submit it', () => {
  // A bare <button> is type="submit". The recording rows moved inside #cfgForm
  // when the fixtures joined the STT card, and Record — created in JS with no
  // type — began reloading the page, discarding the clip and every field above
  // it. Two guards, because they fail differently: the markup one catches a
  // button somebody writes, the handler catches the ones nobody can see,
  // including a stray Enter in a text field.
  const [, source] = /** @type {[string, string, number]} */ (
    PAGES_SRC.find(([n]) => n === 'setup.html'));
  const form = source.slice(source.indexOf('<form id="cfgForm">'), source.indexOf('</form>'));
  const bare = [...form.matchAll(/<button(?![^>]*\btype=)[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(bare, [], 'a button in #cfgForm has no type, so it submits');

  assert.match(read('web/setup.js'), /el\('cfgForm'\)\.addEventListener\('submit'/,
    'setup.js no longer stops #cfgForm from submitting');
  assert.match(read('web/setup.js'), /function rowButton[\s\S]{0,300}?button\.type = 'button'/,
    'rowButton creates a submit button');
});

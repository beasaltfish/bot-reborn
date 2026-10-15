import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** @param {string} rel */
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const productCss = read('phone/style.css');
const instrumentCss = read('phone/instrument.css');

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

// One page, and since the phone became a body (2026-10-15) only the pin
// bench's five cards: the audio and provider cards left with the engines.
const PAGES_SRC = /** @type {[string, string, number][]} */ ([
  ['dev.html', read('phone/dev.html'), 5],
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


test('every "Status:" line for the cable is written where the cable is opened', () => {
  // One page opens one FT232H, and two panels still show a line for it —
  // each wrote its own while each was its own page. What this caught: connect()
  // wrote the connectivity test's line only, so the pin bench, which is the tab
  // you are on when you first plug a freshly soldered board in, went on reading
  // "not connected" with the cable open.
  const dev = read('phone/dev.html');
  const shown = [...dev.matchAll(/id="([^"]+)"[^>]*>\s*Status:/g)].map((m) => m[1]);
  const written = (read('phone/dev.js')
    .match(/for \(const id of \[([^\]]+)\]\) setStat\(id, `Status: /) ?? [])[1];
  assert.ok(written, 'dev.js no longer has one place that writes the cable status');
  assert.deepEqual(
    shown.sort(),
    [...written.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(),
    'a "Status:" line on dev.html is not written when the cable opens',
  );
});

test('every instrument page mounts the strip', () => {
  for (const [name, source] of PAGES_SRC) {
    assert.match(source, /id="instrumentStatus"/, `${name} does not mount the status strip`);
  }
});

test('red is the emergency stop and nothing else', () => {
  // docs/ui.md: the button that must be found instantly stops being findable
  // the moment it is one of several red things.
  // One page, one stop. It used to be three, one per page — and the audio one
  // had a second stop of its own in the bar, for the car it set circling.
  const allowed = /** @type {Record<string, string[]>} */ ({ 'dev.html': ['stopBtn'] });
  for (const [name, source] of PAGES_SRC) {
    const reds = [...source.matchAll(/<button[^>]*\bdanger\b[^>]*>/g)]
      .map((m) => (m[0].match(/id="([^"]+)"/) ?? [])[1]);
    assert.deepEqual(reds.sort(), allowed[name].sort(),
      `${name} paints something red that is not its emergency stop`);
  }
});

test('every id the instruments reach for exists in their markup', () => {
  // The same contract markup.test.js holds for index.html, which the two bench
  // pages never had: a typo here is a blank page at runtime with nothing in the
  // console but "null is not an object", and no other test would notice.
  //
  // Derived rather than listed, so it cannot go stale: every `el('x')` and
  // `$('x')` in a page's own modules has to name something in that page.
  const SOURCES = /** @type {[string, string[]][]} */ ([
    ['phone/dev.html', ['phone/dev.js', 'phone/panels/pins.js']],
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

test('the pins panel registers every control it used to', () => {
  // bench.js attached eleven listeners at the top level of a module. Turning
  // that into a factory is where a button silently stops responding: it throws
  // nothing, it just does nothing, and no other test would notice.
  const js = read('phone/panels/pins.js');
  // connectBtn, stopBtn and copyLogBtn are gone from here on purpose: the page
  // owns the one cable, the one emergency stop and the one log.
  for (const id of ['byteRateBtn', 'computeBtn',
                    'pulseMoved', 'pulseStill', 'pulseReset',
                    'scanAllBtn', 'readPinsBtn', 'listGrantedBtn']) {
    assert.match(js, new RegExp(`'${id}'`), `pins.js no longer touches #${id}`);
  }
  for (const attr of ['data-pins', 'data-pulse']) {
    assert.match(js, new RegExp(attr), `pins.js no longer wires [${attr}]`);
  }
  // And the listeners are inside start(), not at module scope.
  assert.ok(!/^el\(/m.test(js), 'pins.js still attaches listeners at module scope');
});

test('nothing still points at the three pages that were merged away', () => {
  // They each opened their own handle to the same FT232H — fine in three
  // documents, a failed claimInterface in one. A stale reference is a link or a
  // comment sending somebody to a page that no longer exists.
  for (const rel of ['phone/dev.html', 'phone/dev.js', 'phone/settings.js',
                     'core/checks.js', 'phone/panels/pins.js', 'docs/instruments.md']) {
    assert.ok(!/\b(bench|setup|audio-bench)\.html\b/.test(read(rel)),
      `${rel} still points at a page that no longer exists`);
  }
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEADLINES } from '../web/audio-bench/headlines.js';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const audioBench = readFileSync(new URL('../web/audio-bench.html', import.meta.url), 'utf8');

/**
 * How much PROSE a page puts in front of somebody holding a phone — paragraphs
 * only, which is what you scroll past to reach a button.
 *
 * Deliberately not "all the text": a stat row's label, a knob's caption and a
 * dropdown's options are the instrument itself, and counting them would mean a
 * page trips this ratchet for adding a reading. Comments do not count either —
 * they cost the reader nothing and the maintainer everything, which is the
 * trade this whole rule is built on.
 *
 * @param {string} source
 */
function proseWords(source) {
  const body = source.slice(source.indexOf('<body>'));
  return [...body.replace(/<!--[\s\S]*?-->/g, ' ').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' '))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
}
/** @param {string} id */
const hasId = (id) => new RegExp(`id=["']${id}["']`).test(html);

// Every id ui.js reaches for. A typo here is a blank page at runtime with
// nothing in the console but "null is not an object", and no test would catch
// it — ui.js is DOM-bound and this project does not run a DOM in node.
const REQUIRED = [
  'robot', 'bubble', 'fab', 'mic', 'log', 'notice', 'hint',
  'settings', 'sheet', 'settingsTitle', 'settingsRows', 'sheetClose',
  'calSheet', 'cal',
  'setupSheet', 'setupTitle', 'setupTabs', 'setupRows', 'setupNote', 'setupFoot',
  'calFoot',
];

test('index.html provides every element ui.js reaches for', () => {
  for (const id of REQUIRED) assert.ok(hasId(id), `index.html is missing #${id}`);
});

test('the retired ids are gone, not merely hidden', () => {
  // #state became the robot's face and #title was a heading a game screen does
  // not need. Leaving them in place invites ui.js to keep writing to them.
  //
  // #estop is on the list because §5 folded it into #fab: one button, one
  // fixed place, whose face is always the most urgent thing available.
  //
  // #sheetSteps was the onboarding checklist. The robot shows what it is
  // missing now, and a second copy of that answer in the settings sheet said
  // it twice — in text, worse, and one screen further away.
  // #sleep was the footer's "let it sleep". It named what the RED button
  // already does — brake, then go to SLEEPING — while doing something else
  // entirely: shutting the microphone. That job moved to the icon in the
  // topbar, which is also the only thing that shows the ear is open.
  for (const id of ['state', 'title', 'start', 'stop', 'estop', 'sleep',
                    'sheetSteps', 'setupTestAll', 'setupClose']) {
    assert.ok(!hasId(id), `index.html still has the retired #${id}`);
  }
});

test('the robot carries one touch target per gating step', () => {
  // The robot IS the checklist now. A missing band is a step with no door:
  // the ring pulses over a region that does nothing when it is pressed.
  for (const step of ['keys', 'car', 'steer']) {
    assert.match(html, new RegExp(`class=["']part["'] data-part=["']${step}["']`),
      `index.html has no touch target for the "${step}" step`);
  }
});

test('the robot carries a live region, so the face is not the only channel', () => {
  // The face is the whole point, but a screen reader gets nothing from an SVG.
  // ui.js writes the state's own string into this.
  assert.match(html, /id=["']robotLabel["'][^>]*aria-live=["']polite["']/);
});

test('nothing ships wearing red — the fab earns it at runtime', () => {
  // §11: red is the emergency stop's alone. ui.js paints the fab red when it
  // becomes the stop; what the markup must guarantee is that no OTHER element
  // is red, which would make the one button that must be found instantly into
  // one of several red things.
  assert.ok(!/class=["'][^"']*\bdanger\b/.test(html), 'no element may ship with .danger');
});

test('the audio bench fits on a phone rather than reading like a paper', () => {
  // It was 1734 words, which is ten-odd screens of prose before the first
  // button. The argument did not get thrown away — it is in docs/instruments.md
  // — and this is the ratchet that keeps it there. Raising this number is a
  // decision, not a fix: the page is read by somebody standing in a quiet room
  // holding nothing but the phone.
  const words = proseWords(audioBench);
  assert.ok(words < 400,
    `audio-bench.html carries ${words} words of prose; the why belongs in docs/instruments.md`);
});

test('the audio bench ships a picker with one option per panel', () => {
  // A panel with no option is a panel nobody can reach; an option naming no
  // panel is a picker entry that blanks the page.
  const panels = [...audioBench.matchAll(/<section id="panel-([a-z]+)"/g)].map((m) => m[1]);
  const picker = audioBench.slice(audioBench.indexOf('<select id="panelPick">'));
  const options = [...picker.slice(0, picker.indexOf('</select>'))
    .matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert.match(audioBench, /id="panelPick"/);
  assert.deepEqual(panels.sort(), options.sort());
});

test('every headline the bar mirrors exists in the page', () => {
  // The bar reads these ids out of the document. A typo is a bar that stays
  // blank through an entire measurement, with nothing in the console but
  // "null is not an object" — exactly the failure this file was written for.
  for (const [panel, spec] of Object.entries(HEADLINES)) {
    const ids = Array.isArray(spec) ? spec : [spec.mirror];
    for (const id of ids) {
      assert.match(audioBench, new RegExp(`id="${id}"`),
        `audio-bench.html has no #${id}, which ${panel} declares as a headline`);
    }
  }
});

test('every panel declares a headline', () => {
  // A panel with none is a panel whose readings still need scrolling to, which
  // is the whole complaint.
  const panels = [...audioBench.matchAll(/<section id="panel-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(panels.sort(), Object.keys(HEADLINES).sort());
});

test('a headline is at most three readings', () => {
  // Four will not fit beside a picker and a button at 400 px, and a bar that
  // wraps to two lines eats the screen it was meant to save.
  for (const [panel, spec] of Object.entries(HEADLINES)) {
    if (Array.isArray(spec)) {
      assert.ok(spec.length <= 3, `${panel} declares ${spec.length} headlines`);
    }
  }
});

const bench = readFileSync(new URL('../web/bench.html', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../web/setup.html', import.meta.url), 'utf8');

test('the product and the instruments do not share a stylesheet', () => {
  // One file was dressing two audiences, and they undid each other: `.hint` was
  // defined twice, and `.shell` existed only to cancel the `body` padding the
  // benches need. Splitting them is what deletes the counter-rule.
  assert.match(html, /href="style\.css"/);
  assert.ok(!/href="instrument\.css"/.test(html), 'index.html must not link the instrument sheet');
  for (const [name, source] of /** @type {[string, string][]} */ ([
    ['bench', bench], ['setup', setup], ['audio-bench', audioBench],
  ])) {
    assert.match(source, /href="instrument\.css"/, `${name}.html must link instrument.css`);
    assert.ok(!/href="style\.css"/.test(source), `${name}.html must not link the product sheet`);
  }
});

test('the gear has no dead link behind it', () => {
  // settings.js calls preventDefault() and opens the sheet; the href was the
  // page that used to be there. A dead href is a promise the markup makes and
  // the code breaks — and on a slow load it is a promise the markup keeps.
  assert.ok(!/id="settings"[^>]*href=/.test(html),
    'index.html still carries the retired href on #settings');
});

test('the other two instruments were already short, and stay short', () => {
  // Lower ceilings than the audio bench's because these pages are smaller, not
  // because their prose is worth less: a ratchet set above where a page already
  // sits is not a ratchet.
  const setupWords = proseWords(setup);
  const benchWords = proseWords(bench);
  assert.ok(setupWords < 220, `setup.html carries ${setupWords} words of prose`);
  assert.ok(benchWords < 140, `bench.html carries ${benchWords} words of prose`);
});

test('every "why" link lands on a heading that exists', () => {
  // The pages now hand their reasoning to docs/instruments.md and point at it.
  // A link to a heading that was renamed is worse than no link: it looks like
  // the argument is one tap away, and the tap goes nowhere.
  //
  // The slug rule is GitHub's: lower-case, punctuation dropped, spaces to
  // hyphens. An em dash is punctuation, so "Acoustics — ⑥ ⑬" is
  // "acoustics-⑥-⑬" with ONE hyphen, not two.
  const doc = readFileSync(new URL('../docs/instruments.md', import.meta.url), 'utf8');
  /** @param {string} heading */
  const slug = (heading) => heading.trim().toLowerCase()
    .replace(/[^\w\s\-一-鿿①-⓿]/g, '')
    .replace(/\s+/g, '-');
  const headings = new Set([...doc.matchAll(/^#{2,4}\s+(.*)$/gm)].map((m) => slug(m[1])));

  for (const [name, source] of /** @type {[string, string][]} */ ([
    ['audio-bench', audioBench], ['setup', setup], ['bench', bench],
  ])) {
    for (const m of source.matchAll(/docs\/instruments\.md#([^"']+)/g)) {
      assert.ok(headings.has(m[1]),
        `${name}.html links to docs/instruments.md#${m[1]}, which is not a heading there`);
    }
  }
});

test('both stylesheets declare color-scheme', () => {
  // The split lost this once already. It lived at the top of the single
  // stylesheet, the top of that file went to the benches, and index.html spent
  // a commit rendering light-only on a phone set to dark. Nothing else catches
  // it: it is a property on :root, not a class any page names.
  const product = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  const instrument = readFileSync(new URL('../web/instrument.css', import.meta.url), 'utf8');
  for (const [name, css] of /** @type {[string, string][]} */ ([
    ['style.css', product], ['instrument.css', instrument],
  ])) {
    assert.match(css, /color-scheme:\s*light dark/, `${name} does not declare color-scheme`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEADLINES } from '../web/panels/headlines.js';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const dev = readFileSync(new URL('../web/dev.html', import.meta.url), 'utf8');

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

test('the developer page fits on a phone rather than reading like a paper', () => {
  // It was 1734 words, which is ten-odd screens of prose before the first
  // button. The argument did not get thrown away — it is in docs/instruments.md
  // — and this is the ratchet that keeps it there. Raising this number is a
  // decision, not a fix: the page is read by somebody standing in a quiet room
  // holding nothing but the phone.
  const words = proseWords(dev);
  // 760 = the three pages' own ceilings added up (400 + 220 + 140). Merging
  // them was not licence to write more: the three actually summed to 705.
  assert.ok(words < 760,
    `dev.html carries ${words} words of prose; the why belongs in docs/instruments.md`);
});

test('the panel you picked comes before the cards every panel shares', () => {
  // #audioCommon is the same two cards for all four audio panels. Above the
  // group, it made switching between them change nothing a phone can show: the
  // chosen panel was below the fold, and the tabs read as dead.
  const shared = dev.indexOf('<div id="audioCommon"');
  const panels = [...dev.matchAll(/<section id="panel-([a-z]+)"/g)];
  assert.ok(shared > 0, 'dev.html no longer has the shared audio cards');
  for (const m of panels) {
    assert.ok(m.index < shared,
      `#panel-${m[1]} sits after the cards every audio panel shares`);
  }
});

test('there is one tab per panel and no tab without one', () => {
  // A panel with no tab is a panel nobody can reach; a tab naming no panel
  // blanks the page. It was a <select> until 2026-09-21 — three actions per
  // switch, and what was available stayed hidden until you opened it.
  const panels = [...dev.matchAll(/<section id="panel-([a-z]+)"/g)].map((m) => m[1]);
  const tabs = [...dev.matchAll(/data-panel="([a-z]+)"/g)].map((m) => m[1]);
  assert.match(dev, /id="panelTabs"/);
  assert.deepEqual(panels.sort(), tabs.sort());
});

test('exactly one tab starts selected', () => {
  // Two would claim two panels at once; none would open on a page whose tabs
  // all look inactive while a panel is in fact showing.
  assert.equal([...dev.matchAll(/aria-selected="true"/g)].length, 1);
});
test('every headline the bar mirrors exists in the page', () => {
  // The bar reads these ids out of the document. A typo is a bar that stays
  // blank through an entire measurement, with nothing in the console but
  // "null is not an object" — exactly the failure this file was written for.
  for (const [panel, spec] of Object.entries(HEADLINES)) {
    const ids = Array.isArray(spec) ? spec : [spec.mirror];
    for (const id of ids) {
      assert.match(dev, new RegExp(`id="${id}"`),
        `audio-bench.html has no #${id}, which ${panel} declares as a headline`);
    }
  }
});

test('every panel that measures declares a headline', () => {
  // A measuring panel with none is a panel whose readings still need scrolling
  // to, which is the whole complaint.
  //
  // The two passive panels are deliberately absent. They hold no run and no
  // live reading: the pin bench fires a pulse and the connectivity test answers
  // in place, so there is nothing for a bar to follow you with.
  const PASSIVE = ['pins', 'connectivity'];
  const panels = [...dev.matchAll(/<section id="panel-([a-z]+)"/g)]
    .map((m) => m[1]).filter((n) => !PASSIVE.includes(n));
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


test('the product and the instruments do not share a stylesheet', () => {
  // One file was dressing two audiences, and they undid each other: `.hint` was
  // defined twice, and `.shell` existed only to cancel the `body` padding the
  // benches need. Splitting them is what deletes the counter-rule.
  assert.match(html, /href="style\.css"/);
  assert.ok(!/href="instrument\.css"/.test(html), 'index.html must not link the instrument sheet');
  for (const [name, source] of /** @type {[string, string][]} */ ([['dev', dev]])) {
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


test('every "why" link lands on a heading that exists', () => {
  // The pages hand their reasoning to docs/instruments.md and point at it.
  // A link to a heading that was renamed is worse than no link: it looks like
  // the argument is one tap away, and the tap goes nowhere.
  //
  // They point at GitHub, absolutely, and not at `../docs/instruments.md`.
  // `docs/` is outside pages_build_output_dir, so that relative path was never
  // deployed — and Pages answers a missing asset with the root index.html at
  // 200, so the dead link rendered as the robot page with its stylesheet
  // resolved against /docs/ and lost. A raw .md would not have helped: the
  // browser shows it as plain text, where a #heading anchor does not exist.
  //
  // The slug rule is GitHub's, and GitHub's is blunter than it looks:
  // everything outside [a-z0-9 -] is DROPPED — the circled numbers included —
  // and then each remaining space becomes one hyphen, with no collapsing. So
  // "② Byte rate — what one ms" is "-byte-rate--what-one-ms": a leading hyphen
  // where ② was, two hyphens where the em dash was. Ugly, and verified against
  // a rendered README on github.com rather than guessed.
  //
  // It holds only while the headings stay ASCII + circled numbers, which the
  // instruments' English-only rule already guarantees.
  const doc = readFileSync(new URL('../docs/instruments.md', import.meta.url), 'utf8');
  /** @param {string} heading */
  const slug = (heading) => heading.trim().toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
  const headings = new Set([...doc.matchAll(/^#{2,4}\s+(.*)$/gm)].map((m) => slug(m[1])));
  const BASE = 'https://github.com/beasaltfish/bot-reborn/blob/main/docs/instruments.md#';

  for (const [name, source] of /** @type {[string, string][]} */ ([['dev', dev]])) {
    for (const m of source.matchAll(/href="([^"]*instruments\.md#[^"]+)"/g)) {
      assert.ok(m[1].startsWith(BASE),
        `${name}.html links to ${m[1]}; docs/ is not deployed, so the link has to be ${BASE}…`);
      const anchor = m[1].slice(BASE.length);
      assert.ok(headings.has(anchor),
        `${name}.html links to instruments.md#${anchor}, which is not a heading there`);
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

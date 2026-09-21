import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
/** @param {string} id */
const hasId = (id) => new RegExp(`id=["']${id}["']`).test(html);

// Every id ui.js reaches for. A typo here is a blank page at runtime with
// nothing in the console but "null is not an object", and no test would catch
// it — ui.js is DOM-bound and this project does not run a DOM in node.
const REQUIRED = ['robot', 'bubble', 'fab', 'sleep', 'log', 'notice'];

test('index.html provides every element ui.js reaches for', () => {
  for (const id of REQUIRED) assert.ok(hasId(id), `index.html is missing #${id}`);
});

test('the retired ids are gone, not merely hidden', () => {
  // #state became the robot's face and #title was a heading a game screen does
  // not need. Leaving them in place invites ui.js to keep writing to them.
  //
  // #estop is on the list because §5 folded it into #fab: one button, one
  // fixed place, whose face is always the most urgent thing available.
  for (const id of ['state', 'title', 'start', 'stop', 'estop']) {
    assert.ok(!hasId(id), `index.html still has the retired #${id}`);
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

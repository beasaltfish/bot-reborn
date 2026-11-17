import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { createFirmwareStudio } from '../../sim/ui/firmware-studio.js';

/** @param {Record<string, any>} [over] */
function custom(over = {}) {
  return { name: 'mine', draft: '', flashed: '', updatedAt: 1, ...over };
}
/** @param {Record<string, any>} [over] */
function state(over = {}) {
  return over;
}

/** @param {Record<string, any>} [over] */
function setup(over = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const studio = createFirmwareStudio({ lang: 'en', ...over });
  dom.window.document.body.append(studio.element);
  return { dom, studio, restore: () => { globalThis.document = previous; } };
}

test('the drawer is hidden by default and toggles', () => {
  const { studio, restore } = setup();
  try {
    assert.equal(studio.element.hidden, true);
    studio.toggle();
    assert.equal(studio.element.hidden, false);
    studio.close();
    assert.equal(studio.element.hidden, true);
  } finally { restore(); }
});

test('line numbers match the source lines in both views', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ custom: custom({ draft: 'a\nb\nc', flashed: 'x\ny' }) }));
    assert.deepEqual([...studio.element.querySelectorAll('[data-role=line-numbers] span')].map((n) => n.textContent), ['1', '2']);
    studio.update(state({ view: 'draft' }));
    assert.deepEqual([...studio.element.querySelectorAll('[data-role=line-numbers] span')].map((n) => n.textContent), ['1', '2', '3']);
  } finally { restore(); }
});

test('the selector is an inspection target, not the board', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'body' } }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=board]')).textContent, /custom/);
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-source]')).textContent, /Running/);
  } finally { restore(); }
});

test('editing fires onDraft and keeps the running view separate', () => {
  /** @type {string[]} */ const seen = [];
  const { studio, restore } = setup({ onDraft: (/** @type {string} */ s) => seen.push(s) });
  try {
    studio.update(state({ view: 'draft' }));
    const area = /** @type {HTMLTextAreaElement} */ (studio.element.querySelector('[data-role=draft]'));
    area.value = 'void loop(){}';
    area.dispatchEvent(new (globalThis.document.defaultView?.Event ?? Event)('input', { bubbles: true }));
    assert.equal(seen.at(-1), 'void loop(){}');
  } finally { restore(); }
});

test('download asks main for the selected firmware', () => {
  /** @type {any[]} */ const asked = [];
  const { studio, restore } = setup({ onDownload: (/** @type {any} */ s) => asked.push(s) });
  try {
    studio.update(state({ selection: { kind: 'body' } }));
    /** @type {any} */ (studio.element.querySelector('[data-role=download]')).click();
    assert.deepEqual(asked, [{ kind: 'body' }]);
  } finally { restore(); }
});

test('a parse error disables flash', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ errors: [{ line: 2, column: 1, message: "missing ';'" }] }));
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=flash]')).disabled, true);
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=error]')).textContent, /2/);
  } finally { restore(); }
});

test('flash asks for the selected target, not a hardcoded custom', () => {
  /** @type {any[]} */ const flashed = [];
  const { studio, restore } = setup({ onFlash: (/** @type {any} */ s) => { flashed.push(s); } });
  try {
    studio.update(state({ selection: { kind: 'body' }, usb: true }));
    /** @type {HTMLButtonElement} */ (studio.element.querySelector('[data-role=flash]')).click();
    assert.deepEqual(flashed, [{ kind: 'body' }]);
  } finally { restore(); }
});

test('copying a v1 example is enabled only for v1', () => {
  /** @type {any[]} */ const copied = [];
  const { studio, restore } = setup({ onCopyExample: (/** @type {any} */ s) => copied.push(s) });
  try {
    studio.update(state({ selection: { kind: 'sketch', id: 'sketch-button-led' }, exampleV1: false }));
    const copy = /** @type {HTMLButtonElement} */ (studio.element.querySelector('[data-role=copy]'));
    assert.equal(copy.disabled, true);
    studio.update(state({ exampleV1: true }));
    assert.equal(copy.disabled, false);
    copy.click();
    assert.equal(copied.length, 1);
  } finally { restore(); }
});

function frameScheduler() {
  /** @type {(() => void)[]} */ const queue = [];
  return { schedule: (/** @type {() => void} */ fn) => queue.push(fn), flush() { for (const fn of queue.splice(0)) fn(); } };
}

test('a frame adds at most 20 rows and the DOM keeps at most 200', () => {
  const frames = frameScheduler();
  const { studio, restore } = setup({ scheduleFrame: frames.schedule });
  try {
    studio.update(state({ running: true }));
    studio.pushTrace(Array.from({ length: 250 }, (_, i) => ({ tick: i, kind: 'statement', line: 1, text: `x${i}` })));
    frames.flush();
    assert.ok(studio.element.querySelectorAll('[data-role=trace]').length <= 20);
    frames.flush();
    assert.ok(studio.element.querySelectorAll('[data-role=trace]').length <= 40);
    for (let i = 0; i < 20; i++) frames.flush();
    assert.ok(studio.element.querySelectorAll('[data-role=trace]').length <= 200);
  } finally { restore(); }
});

test('trace rows group by tick and render once per frame', () => {
  const frames = frameScheduler();
  const { studio, restore } = setup({ scheduleFrame: frames.schedule });
  try {
    studio.update(state({ running: true }));
    studio.pushTrace([{ tick: 1, kind: 'statement', line: 9, text: 'digitalRead(4)' }]);
    studio.pushTrace([{ tick: 2, kind: 'statement', line: 10, text: 'digitalWrite(5, HIGH)' }]);
    assert.equal(studio.element.querySelectorAll('[data-role=trace]').length, 0);
    frames.flush();
    const rows = studio.element.querySelectorAll('[data-role=trace]');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /9/);
  } finally { restore(); }
});

test('a paused timeline updates memory only and renders on resume', () => {
  const frames = frameScheduler();
  const { studio, restore } = setup({ scheduleFrame: frames.schedule });
  try {
    studio.update(state({ running: true }));
    /** @type {any} */ (studio.element.querySelector('[data-role=pause]')).click();
    studio.pushTrace([{ tick: 3, kind: 'statement', line: 11, text: 'delay(100)' }]);
    frames.flush();
    assert.equal(studio.element.querySelectorAll('[data-role=trace]').length, 0);
    /** @type {any} */ (studio.element.querySelector('[data-role=pause]')).click();
    frames.flush();
    assert.equal(studio.element.querySelectorAll('[data-role=trace]').length, 1);
  } finally { restore(); }
});

test('the timeline only references the running source', () => {
  const frames = frameScheduler();
  const { studio, restore } = setup({ scheduleFrame: frames.schedule });
  try {
    studio.update(state({ view: 'draft', custom: custom({ draft: 'a\nb\nc', flashed: 'x\ny' }) }));
    studio.pushTrace([{ tick: 1, kind: 'statement', line: 2, text: 'x' }]);
    frames.flush();
    const row = /** @type {any} */ (studio.element.querySelector('[data-role=trace]'));
    row.click();
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=run-source]')).hidden, false);
    assert.equal(studio.element.dataset.view, 'run');
  } finally { restore(); }
});

test('timing is shown as interpreter and UI separately', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ timings: { interpreterMs: 3.2, uiMs: 0.6 } }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=timing]')).textContent, /3\.2\/6.*0\.6\/2/);
  } finally { restore(); }
});

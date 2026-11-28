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

test('line numbers match the source lines in both custom views', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'custom' }, custom: custom({ draft: 'a\nb\nc', flashed: 'x\ny' }) }));
    assert.deepEqual([...studio.element.querySelectorAll('[data-role=line-numbers] span')].map((n) => n.textContent), ['1', '2']);
    studio.update(state({ view: 'draft' }));
    assert.deepEqual([...studio.element.querySelectorAll('[data-role=line-numbers] span')].map((n) => n.textContent), ['1', '2', '3']);
  } finally { restore(); }
});

test('the selector is an inspection target, not the board', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'body' }, source: 'int main(void) {}', custom: custom({ flashed: 'void loop(){}' }) }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=board]')).textContent, /custom/);
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /running source/);
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=run-code]')).textContent, 'int main(void) {}');
  } finally { restore(); }
});

test('the run note names the firmware the board actually runs', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ board: { firmware: 'body' } }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /serial console/);
    studio.update(state({ board: { firmware: 'sketch-env-display' } }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /line-by-line/);
    studio.update(state({ board: { firmware: 'custom' }, custom: custom() }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /No flashed source/);
    studio.update(state({ board: { firmware: 'custom' }, custom: custom({ flashed: 'void loop(){}' }) }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /running source/);
    studio.update(state({ board: { firmware: '' } }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /Blank chip/);
  } finally { restore(); }
});

test('the board mark appears only when the selection is what the board runs', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'custom' } }));
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=board-mark]')).hidden, false);
    studio.update(state({ selection: { kind: 'body' } }));
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=board-mark]')).hidden, true);
  } finally { restore(); }
});

test('a dirty draft is marked not flashed', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'custom' }, custom: custom({ draft: 'new', flashed: 'old' }) }));
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=dirty]')).hidden, false);
    studio.update(state({ custom: custom({ draft: 'same', flashed: 'same' }) }));
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=dirty]')).hidden, true);
  } finally { restore(); }
});

test('an unplugged flash button says it will insert the cable for the target', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({ selection: { kind: 'custom' }, usb: false }));
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=flash]')).textContent, /Insert USB.*custom/);
    studio.update(state({ usb: true }));
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=flash]')).textContent, 'Flash');
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

test('a simulation model is read-only: no selector, flash, download or copy', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({
      board: { firmware: 'sketch-env-display' },
      selection: { kind: 'sketch', id: 'sketch-env-display' },
      source: 'void loop() {}',
      exampleV1: true,
    }));
    const selector = /** @type {HTMLSelectElement} */ (studio.element.querySelector('[data-role=selector]'));
    assert.equal(selector.hidden, true);
    for (const role of ['flash', 'download', 'copy']) {
      assert.equal(/** @type {HTMLElement} */ (studio.element.querySelector(`[data-role=${role}]`)).hidden, true, role);
    }
    assert.match(studio.element.querySelector('h2')?.textContent ?? '', /Simulation/);
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=run-note]')).textContent, /not firmware/);
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=board-mark]')).hidden, true);
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=copy]')).disabled, true);

    studio.update(state({ selection: { kind: 'body' }, board: { firmware: 'body' } }));
    assert.equal(selector.hidden, false);
    assert.equal(/** @type {HTMLElement} */ (studio.element.querySelector('[data-role=flash]')).hidden, false);
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

test('Escape closes the open drawer', () => {
  const { dom, studio, restore } = setup();
  try {
    studio.open();
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(studio.element.hidden, true);
  } finally { restore(); }
});

test('the timeline skips tick and waiting markers', () => {
  const frames = frameScheduler();
  const { studio, restore } = setup({ scheduleFrame: frames.schedule });
  try {
    studio.update(state({ running: true }));
    studio.pushTrace([
      { tick: 1, kind: 'tick' },
      { tick: 1, line: 7, kind: 'statement', text: 'if' },
      { tick: 1, kind: 'waiting' },
      { tick: 1, line: 13, kind: 'statement', text: 'delay(100)' },
    ]);
    frames.flush();
    const rows = [...studio.element.querySelectorAll('[data-role=trace]')].map((r) => r.textContent);
    assert.deepEqual(rows, ['7 if', '13 delay(100)']);
  } finally { restore(); }
});

test('timing updates do not rebuild the editor', () => {
  const { studio, restore } = setup({ onDraft: () => {} });
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'custom' }, custom: custom({ draft: 'x', flashed: 'x' }) }));
    const area = /** @type {HTMLTextAreaElement} */ (studio.element.querySelector('[data-role=draft]'));
    studio.setTiming({ interpreterMs: 4.2, uiMs: 0.4 });
    assert.equal(/** @type {any} */ (studio.element.querySelector('[data-role=draft]')), area);
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=timing]')).textContent, /4\.2\/6.*0\.4\/2/);
  } finally { restore(); }
});

test('a runtime error marks the run gutter without disabling flash', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({
      board: { firmware: 'custom' },
      selection: { kind: 'custom' },
      custom: custom({ draft: 'a\nb', flashed: 'x\ny' }),
      runError: { line: 2, column: 1, message: 'firmware stopped: loop did not finish' },
    }));
    const flash = /** @type {any} */ (studio.element.querySelector('[data-role=flash]'));
    assert.equal(flash.disabled, false);
    assert.match(/** @type {any} */ (studio.element.querySelector('[data-role=error]')).textContent, /did not finish/);
    const spans = [...studio.element.querySelectorAll('[data-role=line-numbers] span')];
    assert.equal(spans[1].classList.contains('error'), true);
    assert.equal(spans[0].classList.contains('error'), false);
  } finally { restore(); }
});

test('a parse error marks the draft gutter, not the running one', () => {
  const { studio, restore } = setup();
  try {
    studio.update(state({
      board: { firmware: 'custom' },
      selection: { kind: 'custom' },
      custom: custom({ draft: 'a\nb', flashed: 'x\ny' }),
      errors: [{ line: 2, column: 1, message: "expected ';'" }],
    }));
    let spans = [...studio.element.querySelectorAll('[data-role=line-numbers] span')];
    assert.equal(spans.some((s) => s.classList.contains('error')), false);
    studio.update(state({ view: 'draft' }));
    spans = [...studio.element.querySelectorAll('[data-role=line-numbers] span')];
    assert.equal(spans[1].classList.contains('error'), true);
  } finally { restore(); }
});

test('a new session clears rows, pending work and highlight', () => {
  const frames = frameScheduler();
  const { studio, restore } = setup({ scheduleFrame: frames.schedule });
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'custom' }, custom: custom({ draft: 'x', flashed: 'x' }) }));
    studio.pushTrace([{ tick: 1, line: 1, kind: 'statement', text: 'old' }]);
    frames.flush();
    assert.equal(studio.element.querySelectorAll('[data-role=trace]').length, 1);
    studio.resetTrace();
    assert.equal(studio.element.querySelectorAll('[data-role=trace]').length, 0);
    assert.equal(studio.state.rendered, 0);
    assert.equal(studio.state.highlight, 0);
    studio.pushTrace([{ tick: 1, line: 1, kind: 'statement', text: 'new' }]);
    frames.flush();
    const rows = [...studio.element.querySelectorAll('[data-role=trace]')].map((r) => r.textContent);
    assert.deepEqual(rows, ['1 new']);
  } finally { restore(); }
});

test('clicking a timeline row asks main to follow the running source', () => {
  const frames = frameScheduler();
  /** @type {any[]} */ const picked = [];
  const { studio, restore } = setup({ scheduleFrame: frames.schedule, onTracePick: (/** @type {any} */ r) => picked.push(r) });
  try {
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'body' } }));
    studio.pushTrace([{ tick: 1, line: 4, kind: 'statement', text: 'x' }]);
    frames.flush();
    /** @type {any} */ (studio.element.querySelector('[data-role=trace]')).click();
    assert.equal(picked[0].line, 4);
    assert.equal(studio.element.dataset.view, 'run');
  } finally { restore(); }
});

test('a long draft grows the textarea so line numbers scroll with the code', () => {
  const { studio, restore } = setup();
  try {
    const long = Array.from({ length: 60 }, (_, i) => `int v${i} = ${i};`).join('\n');
    studio.update(state({ board: { firmware: 'custom' }, selection: { kind: 'custom' }, custom: custom({ draft: long, flashed: long }), view: 'draft' }));
    const area = /** @type {HTMLTextAreaElement} */ (studio.element.querySelector('[data-role=draft]'));
    assert.equal(area.rows, 60);
    assert.equal(studio.element.querySelectorAll('[data-role=line-numbers] span').length, 60);
  } finally { restore(); }
});

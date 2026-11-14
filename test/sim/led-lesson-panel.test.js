import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createLedLessonPanel } from '../../sim/ui/led-lesson-panel.js';
import { LESSON_PROGRESS_KEY } from '../../sim/lessons/progress.js';

/** @param {Record<string,string>} initial */
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (/** @type {string} */ key) => data.get(key) ?? null, setItem: (/** @type {string} */ key, /** @type {string} */ value) => { data.set(key, value); } };
}

test('five stages use real interactions and restore locally saved progress', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const storage = store();
    const panel = createLedLessonPanel({ store: storage, lang: 'en' });
    document.body.append(panel.element);
    const click = (/** @type {string} */ selector) => { const button = /** @type {HTMLButtonElement|null} */ (panel.element.querySelector(selector)); assert.ok(button, selector); button.click(); };
    click('[data-action="acknowledge"]');
    click('[data-action="next"]');
    panel.selectPin('A'); panel.selectPin('K');
    click('[data-action="next"]');
    for (const index of [0, 1, 2]) click(`[data-connect="${index}"]`);
    click('[data-action="next"]');
    panel.controlChanged('voltage'); panel.controlChanged('resistance');
    click('[data-action="next"]');
    panel.experiment({ reversed: true, voltage: 5, resistance: 220, state: 'reversed' });
    panel.experiment({ reversed: false, voltage: 5, resistance: 0, state: 'overcurrent' });
    const saved = JSON.parse(storage.getItem(LESSON_PROGRESS_KEY) ?? 'null');
    assert.deepEqual(saved.lessons['led-5mm-basics-v1'].completedStageIds, ['recognize', 'pins', 'wire', 'try', 'fault']);
    const restored = createLedLessonPanel({ store: storage, lang: 'zh' });
    assert.match(restored.element.textContent ?? '', /故障与解释/);
    assert.match(restored.element.textContent ?? '', /已完成/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('navigation does not require completion and unavailable storage is explained', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const panel = createLedLessonPanel({ store: null, lang: 'en' });
    document.body.append(panel.element);
    for (let i = 0; i < 4; i++) /** @type {HTMLButtonElement} */ (panel.element.querySelector('[data-action="next"]')).click();
    assert.match(panel.element.textContent ?? '', /Break and explain/);
    assert.equal(document.activeElement?.getAttribute('data-action'), 'back');
    assert.match(panel.element.textContent ?? '', /not saved/i);
  } finally { globalThis.document = previous; dom.window.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createBme280LessonPanel } from '../../sim/ui/bme280-lesson-panel.js';
import { createBme280LabExample } from '../../sim/lessons/bme280-example.js';
import { LESSON_PROGRESS_KEY } from '../../sim/lessons/progress.js';

function store() {
  /** @type {Map<string,string>} */ const data = new Map();
  return { getItem: (/** @type {string} */ key) => data.get(key) ?? null, setItem: (/** @type {string} */ key, /** @type {string} */ value) => { data.set(key, value); } };
}

test('BME280 lesson completes through actual pin, circuit, environment and fault actions', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const storage = store(), example = createBme280LabExample(); let updates = 0;
    const panel = createBme280LessonPanel({ store: storage, lang: 'en', example, changed: () => { updates++; } });
    document.body.append(panel.element);
    const click = (/** @type {string} */ selector) => { const button = /** @type {HTMLButtonElement|null} */ (panel.element.querySelector(selector)); assert.ok(button, selector); button.click(); };
    click('[data-action="acknowledge"]'); click('[data-action="next"]');
    for (const pin of ['VIN', 'GND', 'SDI', 'SCK', 'SDO']) panel.selectPin(pin);
    const address = /** @type {HTMLSelectElement} */ (panel.element.querySelector('[data-control="address"]'));
    address.value = '0x76'; address.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    click('[data-action="next"]');
    for (const i of [0, 1, 2, 3]) click(`[data-connect="${i}"]`);
    click('[data-action="next"]');
    for (const key of ['temperatureC', 'humidityPct', 'pressureHpa']) panel.controlChanged(key);
    click('[data-action="next"]');
    click('[data-scenario="swapped"]'); click('[data-scenario="conflict"]');
    const saved = JSON.parse(storage.getItem(LESSON_PROGRESS_KEY) ?? 'null');
    assert.deepEqual(saved.lessons['bme280-i2c-basics-v1'].completedStageIds, ['recognize', 'pins', 'wire', 'try', 'fault']);
    assert.ok(updates >= 3);
    const restored = createBme280LessonPanel({ store: storage, lang: 'zh', example: createBme280LabExample(), changed() {} });
    assert.match(restored.element.textContent ?? '', /故障与解释/);
    assert.match(restored.element.textContent ?? '', /已完成/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

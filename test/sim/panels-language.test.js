import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createPanels } from '../../sim/panels.js';
import { planById } from '../../sim/plan.js';

test('Chinese workbench exposes translated primary controls and recipe choices', () => {
  const dom = new JSDOM('<!doctype html><html lang="zh"><body></body></html>', { url: 'https://example.test/sim/' });
  const previous = { document: globalThis.document, window: globalThis.window, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    /** @type {[string,string][]} */ const runs = [];
    const panels = createPanels(/** @type {any} */ ({ hint() { return '提示'; }, reset() {}, follow() {}, add() {}, carry() {}, start: (/** @type {string} */ id, /** @type {string} */ mode) => { runs.push([id, mode]); return { next() {}, finish() {}, skip() {}, stop() {}, speed() {} }; }, speed: 1, rememberSpeed() {},
      projectState: (/** @type {string} */ id) => { const plan = planById(id); return { mode: plan ? 'guided' : 'free', evaluated: true, project: plan, progress: [], selection: null, diagnoses: [] }; },
    }));
    const labels = [...dom.window.document.querySelectorAll('#tools button')].map(button => button.textContent);
    for (const label of ['元件', '项目', '接线总览', '下一步提示', '重置工作台']) assert.ok(labels.includes(label), label);
    panels.openProject('audio');
    const demo = /** @type {HTMLButtonElement} */ (dom.window.document.querySelector('#project-panel [data-action="demo"]'));
    assert.ok(demo); demo.click();
    const step = /** @type {HTMLButtonElement} */ (dom.window.document.querySelector('#project-panel [data-action="step"]'));
    assert.ok(step); step.click();
    assert.deepEqual(runs, [['audio', 'watch'], ['audio', 'step']]);
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; globalThis.addEventListener = previous.addEventListener; dom.window.close(); }
});

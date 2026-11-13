import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createPanels } from '../../sim/panels.js';
import { PROJECTS, projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { emptyBench } from '../../sim/bench.js';

test('project panel switches modes, focuses connections and yields to Parts', () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'https://example.test/sim/' });
  const previous = { document: globalThis.document, window: globalThis.window, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    /** @type {string[][]} */ const focused = [];
    const panels = createPanels(/** @type {any} */ ({ hint() {}, reset() {}, follow() {}, add() {}, carry() {}, start() {}, speed: 1, rememberSpeed() {},
      projectState: (/** @type {string} */ id) => { const project = projectById(id); return { mode: project ? 'guided' : 'free', project, progress: project ? connectionProgress(emptyBench(), project) : [], selection: null, diagnoses: [] }; },
      focusProject: (/** @type {string[]} */ points) => focused.push(points), clearProjectFocus() {},
    }));
    const button = [...dom.window.document.querySelectorAll('#tools button')].find(b => b.textContent === 'Projects');
    assert.ok(button); button.click();
    const panel = /** @type {HTMLElement} */ (dom.window.document.querySelector('#project-panel'));
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent ?? '', /Diagnostics/);
    const select = /** @type {HTMLSelectElement} */ (panel.querySelector('select'));
    const options = [...select.options].map(option => option.value);
    assert.equal(options.length, PROJECTS.length);
    assert.ok(options.includes('power-a-rail') && options.includes('environment-display'));
    select.value = 'audio'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.ok(panel.querySelector('[data-status="missing"]'));
    /** @type {HTMLButtonElement} */ (panel.querySelector('[data-status] button')).click();
    assert.deepEqual(focused, [['mic:VDD', 'esp:3V3']]);
    panels.selectProject('power-a-rail');
    assert.match(panel.textContent ?? '', /0\/5 complete/);
    const leave = /** @type {HTMLButtonElement} */ (panel.querySelector('[data-action="leave"]'));
    assert.ok(leave); leave.click();
    assert.equal(select.value, '');
    panels.selectProject('power-a-rail');
    panels.selectProject('toy');
    assert.equal(select.value, 'toy');
    const parts = [...dom.window.document.querySelectorAll('#tools button')].find(b => b.textContent === 'Parts');
    assert.ok(parts); parts.click();
    assert.equal(panel.hidden, true);
    assert.equal(/** @type {HTMLElement} */ (dom.window.document.querySelector('#partsbin')).hidden, false);
    Object.defineProperty(dom.window, 'innerWidth', { value: 390, configurable: true });
    button.click();
    /** @type {HTMLButtonElement} */ (panel.querySelector('[data-status] button')).click();
    assert.equal(panel.hidden, true, 'small screens free the bench when focusing');
    assert.ok(focused.length >= 2);
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; globalThis.addEventListener = previous.addEventListener; dom.window.close(); }
});

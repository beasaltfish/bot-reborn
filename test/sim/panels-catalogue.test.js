import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createPanels } from '../../sim/panels.js';

test('Parts opens the live catalogue with breadboard, search, add, learn and persistent favourites', () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><body></body></html>', { url: 'https://example.test/sim/' });
  const previous = { document: globalThis.document, window: globalThis.window, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    /** @type {string[]} */ const events = [];
    createPanels(/** @type {any} */ ({ hint() {}, reset() {}, follow() {}, add: (/** @type {string} */ p) => events.push(`add:${p}`), carry() {}, learn: (/** @type {string} */ p) => events.push(`learn:${p}`), start() {}, speed: 1, rememberSpeed() {} }));
    const button = [...dom.window.document.querySelectorAll('#tools button')].find(b => b.textContent === 'Parts');
    assert.ok(button); button.click();
    const panel = /** @type {HTMLElement} */ (dom.window.document.querySelector('#partsbin'));
    assert.equal(panel.hidden, false);
    const breadboard = panel.querySelector('[data-part="breadboard"]');
    assert.ok(breadboard);
    /** @type {HTMLButtonElement} */ (breadboard.querySelector('[data-action=add]')).click();
    assert.ok(events.includes('add:breadboard'));
    const input = /** @type {HTMLInputElement} */ (panel.querySelector('input[type=search]'));
    input.value = 'led-5mm'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const led = panel.querySelector('[data-part="led-5mm"]');
    assert.ok(led);
    assert.equal(panel.querySelector('[data-part="breadboard"]'), null);
    /** @type {HTMLButtonElement} */ (led.querySelector('[data-action=add]')).click();
    /** @type {HTMLButtonElement} */ (led.querySelector('[data-action=learn]')).click();
    const favourite = /** @type {HTMLButtonElement} */ (led.querySelector('[data-action=favourite]'));
    favourite.focus(); favourite.click();
    assert.equal(dom.window.document.activeElement, panel.querySelector('[data-part="led-5mm"] [data-action=favourite]'));
    assert.ok(events.includes('add:led-5mm'));
    assert.ok(events.includes('learn:led-5mm'));
    assert.match(dom.window.localStorage.getItem('botreborn.sim.favourites') ?? '', /led-5mm/);
    assert.equal(panel.querySelector('[data-part="led-5mm"] [data-action=favourite]')?.getAttribute('aria-pressed'), 'true');
    const projectSelect = /** @type {HTMLSelectElement} */ (dom.window.document.querySelector('#project-panel select'));
    projectSelect.value = 'audio';
    projectSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const diagram = [...dom.window.document.querySelectorAll('#tools button')].find(b => b.textContent === 'Wiring overview');
    assert.ok(diagram); diagram.click();
    assert.equal(panel.hidden, true);
    assert.equal(/** @type {HTMLElement} */ (dom.window.document.querySelector('#diagram')).hidden, false);
  } finally {
    globalThis.document = previous.document; globalThis.window = previous.window; globalThis.addEventListener = previous.addEventListener;
    dom.window.close();
  }
});

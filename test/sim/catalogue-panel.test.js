import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { catalogueView } from '../../sim/ui/catalogue-model.js';
import { createCataloguePanel } from '../../sim/ui/catalogue-panel.js';

test('catalogue exposes search, filters, required parts and labelled actions', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    /** @type {string[]} */ const events = [];
    const panel = createCataloguePanel({ lang: 'en', add: p => events.push(`add:${p}`), carry: p => events.push(`carry:${p}`), learn: p => events.push(`learn:${p}`), setQuery: q => events.push(`query:${q}`), toggleCategory: id => events.push(`category:${id}`), toggleTag: id => events.push(`tag:${id}`), toggleFavourite: p => events.push(`favourite:${p}`) });
    dom.window.document.body.append(panel.element);
    panel.render({ query: 'led', sections: catalogueView({ query: 'led', required: ['resistor'], favourites: ['led-5mm'] }), categories: [{ id: 'fundamental', label: 'Basic components' }], tags: ['GPIO'], selectedCategories: ['fundamental'], selectedTags: [] });
    panel.open();
    assert.equal(panel.element.hidden, false);
    const search = /** @type {HTMLInputElement} */ (panel.element.querySelector('input[type=search]'));
    assert.equal(search.value, 'led');
    assert.ok(search.labels?.length);
    search.value = 'resistor'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.ok(events.includes('query:resistor'));
    const category = /** @type {HTMLButtonElement} */ (panel.element.querySelector('[data-category="fundamental"]'));
    assert.equal(category.getAttribute('aria-pressed'), 'true');
    category.click();
    const tag = /** @type {HTMLButtonElement} */ (panel.element.querySelector('[data-tag="GPIO"]'));
    assert.equal(tag.getAttribute('aria-pressed'), 'false');
    tag.click();
    assert.ok(events.includes('category:fundamental'));
    assert.ok(events.includes('tag:GPIO'));
    assert.match(panel.element.textContent ?? '', /Required/);
    const resistor = /** @type {HTMLElement} */ (panel.element.querySelector('[data-part="resistor"]'));
    assert.ok(resistor);
    assert.match(resistor.textContent ?? '', /LED circuit only/);
    assert.match(resistor.textContent ?? '', /No firmware required/);
    assert.doesNotMatch(resistor.textContent ?? '', /Firmware not supported/);
    /** @type {HTMLButtonElement} */ (resistor.querySelector('[data-action="add"]')).click();
    /** @type {HTMLButtonElement} */ (resistor.querySelector('[data-action="learn"]')).click();
    const led = /** @type {HTMLElement} */ (panel.element.querySelector('[data-part="led-5mm"]'));
    assert.match(led.textContent ?? '', /2 V.*model/i);
    const favourite = /** @type {HTMLButtonElement} */ (led.querySelector('[data-action="favourite"]'));
    assert.equal(favourite.getAttribute('aria-pressed'), 'true');
    favourite.click();
    assert.ok(events.includes('add:resistor'));
    assert.ok(events.includes('learn:resistor'));
    assert.ok(events.includes('favourite:led-5mm'));
    panel.close();
    assert.equal(panel.element.hidden, true);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('drag starts on an entry but not its action buttons, and search stays focused on rerender', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    /** @type {string[]} */ const carried = [];
    const panel = createCataloguePanel({ lang: 'zh', add() {}, carry: p => carried.push(p), learn() {}, setQuery() {}, toggleCategory() {}, toggleTag() {}, toggleFavourite() {} });
    dom.window.document.body.append(panel.element);
    const state = { query: '', sections: catalogueView({ query: 'resistor', lang: 'zh' }), categories: [], tags: [], selectedCategories: [], selectedTags: [] };
    panel.render(state); panel.open();
    const search = /** @type {HTMLInputElement} */ (panel.element.querySelector('input'));
    search.focus();
    panel.render({ ...state, query: 'r' });
    assert.equal(dom.window.document.activeElement, search);
    const card = /** @type {HTMLElement} */ (panel.element.querySelector('[data-part="resistor"]'));
    const fire = (/** @type {Element} */ target) => {
      const e = new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0 });
      target.dispatchEvent(e);
    };
    fire(/** @type {HTMLButtonElement} */ (card.querySelector('[data-action="add"]')));
    assert.deepEqual(carried, []);
    fire(card);
    assert.deepEqual(carried, []);
    dom.window.dispatchEvent(new dom.window.MouseEvent('pointermove', { clientX: 8, clientY: 0, bubbles: true, button: 0 }));
    assert.deepEqual(carried, ['resistor']);
  } finally { globalThis.document = previous; dom.window.close(); }
});

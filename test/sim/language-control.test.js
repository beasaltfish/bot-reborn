import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createLanguageControl } from '../../sim/ui/language-control.js';

test('language selector restores the current choice if the change is cancelled', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    /** @type {string[]} */ const changes = [];
    let accept = false;
    const control = createLanguageControl('en', lang => { changes.push(lang); return accept; });
    dom.window.document.body.append(control.element);
    const select = /** @type {HTMLSelectElement} */ (control.element.querySelector('select'));
    assert.ok(select.labels?.length);
    assert.equal(control.element.textContent?.includes('Language / 语言'), false);
    assert.equal(select.getAttribute('aria-label'), 'Language');
    select.value = 'zh'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(select.value, 'en');
    accept = true;
    select.value = 'zh'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(select.value, 'zh');
    assert.deepEqual(changes, ['zh', 'zh']);
  } finally { globalThis.document = previous; dom.window.close(); }
});

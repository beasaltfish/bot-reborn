import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createButtonLabPanel } from '../../sim/ui/button-lab-panel.js';

test('button lesson shows explicit pull, momentary keyboard press and release', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const old = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  try {
    const panel = createButtonLabPanel('en'); document.body.append(panel.element);
    const button = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button'));
    const select = /** @type {HTMLSelectElement} */ (panel.element.querySelector('select'));
    assert.match(panel.element.textContent ?? '', /hypothetical/i);
    assert.match(panel.element.querySelector('[role="status"]')?.textContent ?? '', /high/i);
    button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert.match(panel.element.querySelector('[role="status"]')?.textContent ?? '', /low/i);
    button.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    select.value = 'none'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.match(panel.element.querySelector('[role="status"]')?.textContent ?? '', /floating/i);
    panel.setLanguage('zh');
    assert.match(panel.element.querySelector('[role="status"]')?.textContent ?? '', /悬空/);
    panel.dispose();
  } finally { globalThis.document = old.document; globalThis.window = old.window; dom.window.close(); }
});

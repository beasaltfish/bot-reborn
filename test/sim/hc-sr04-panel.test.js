import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createSonarLabPanel } from '../../sim/ui/hc-sr04-panel.js';

test('hypothetical sonar demo requires an explicit trigger and invalidates stale readings', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const panel = createSonarLabPanel('en'); document.body.append(panel.element);
    assert.match(panel.element.textContent ?? '', /hypothetical/i);
    assert.match(panel.element.textContent ?? '', /not proof/i);
    const slider = /** @type {HTMLInputElement} */ (panel.element.querySelector('input'));
    const button = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button'));
    assert.match(panel.element.querySelector('[role=status]')?.textContent ?? '', /no measurement/i);
    slider.value = '25'; slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    button.click();
    assert.match(panel.element.querySelector('[role=status]')?.textContent ?? '', /25 cm.*1450 µs/);
    slider.value = '30'; slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.match(panel.element.querySelector('[role=status]')?.textContent ?? '', /no measurement/i);
    panel.setLanguage('zh');
    assert.match(panel.element.textContent ?? '', /假设/);
    button.click();
    assert.match(panel.element.querySelector('[role=status]')?.textContent ?? '', /30 cm.*1740 µs/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

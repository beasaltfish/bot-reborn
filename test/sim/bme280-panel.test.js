import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createBme280Panel } from '../../sim/ui/bme280-panel.js';
import { defaultStimuli, setStimulus } from '../../sim/stimuli.js';

test('sensor panel distinguishes simulation from firmware and updates live readings', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    let stimuli = defaultStimuli();
    const panel = createBme280Panel({ lang: 'en', change: (key, value) => { stimuli = setStimulus(stimuli, key, value); panel.update({ state: 'ready', telemetry: stimuli }, stimuli); } });
    document.body.append(panel.element);
    panel.update({ state: 'off', telemetry: null }, stimuli);
    assert.match(panel.element.textContent ?? '', /firmware.*not supported/i);
    assert.match(panel.element.textContent ?? '', /no readings/i);
    const temperature = /** @type {HTMLInputElement} */ (panel.element.querySelector('[data-stimulus="temperatureC"]'));
    temperature.value = '200'; temperature.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(stimuli.temperatureC, 85);
    assert.equal(temperature.value, '85');
    assert.match(panel.element.textContent ?? '', /85 °C/);
    panel.update({ state: 'address-conflict', telemetry: null }, stimuli);
    assert.match(panel.element.textContent ?? '', /address conflict/i);
    assert.doesNotMatch(panel.element.querySelector('[data-readings]')?.textContent ?? '', /85 °C/);
    panel.setLanguage('zh');
    assert.match(panel.element.textContent ?? '', /地址冲突/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('invalid inputs do not change environment and revert on blur', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    let changes = 0;
    const panel = createBme280Panel({ lang: 'en', change: () => { changes++; } });
    document.body.append(panel.element);
    panel.update({ state: 'off', telemetry: null }, defaultStimuli());
    const field = /** @type {HTMLInputElement} */ (panel.element.querySelector('[data-stimulus="humidityPct"]'));
    field.value = ''; field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(changes, 0);
    field.dispatchEvent(new dom.window.Event('blur'));
    assert.equal(field.value, '50');
  } finally { globalThis.document = previous; dom.window.close(); }
});

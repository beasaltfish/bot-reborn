import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { createPanels } from '../../sim/panels.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { defaultStimuli } from '../../sim/stimuli.js';

test('BME280 part menu refreshes simulated readings without replacing its controls', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = { document: globalThis.document, window: globalThis.window, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    const panels = createPanels(/** @type {any} */ ({ hint() {}, reset() {}, follow() {}, add() {}, carry() {}, start() {}, speed: 1, rememberSpeed() {} }));
    const environment = defaultStimuli();
    /** @type {[string,number][]} */ const changes = [];
    panels.partMenu('env', 10, 10, DEVICES['bme280-i2c'].properties, { address: '0x77' }, null, () => {}, { state: { state: 'off', telemetry: null }, environment, change: (key, value) => changes.push([key, value]) });
    const input = /** @type {HTMLInputElement|null} */ (document.querySelector('[data-stimulus="temperatureC"]'));
    assert.ok(input);
    panels.refreshPart('env', { address: '0x77' }, { state: 'ready', telemetry: environment }, environment);
    assert.equal(document.querySelector('[data-stimulus="temperatureC"]'), input);
    assert.match(document.querySelector('[data-readings]')?.textContent ?? '', /22 °C/);
    input.value = '26'; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(changes, [['temperatureC', 26]]);
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; globalThis.addEventListener = previous.addEventListener; dom.window.close(); }
});

test('part and wire menus use schema controls and shared colours while preserving momentary press', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = { document: globalThis.document, window: globalThis.window, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    const panels = createPanels(/** @type {any} */ ({ hint() {}, reset() {}, follow() {}, add() {}, carry() {}, start() {}, speed: 1, rememberSpeed() {} }));
    /** @type {[string, number|string|boolean][]} */
    const changes = [];
    panels.partMenu('bme', 10, 10, DEVICES['bme280-i2c'].properties, { address: '0x77' }, null, (key, value) => changes.push([key, value]));
    const select = /** @type {HTMLSelectElement} */ (dom.window.document.querySelector('#wire-menu select'));
    assert.ok(select);
    select.value = '0x76';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(changes, [['address', '0x76']]);
    assert.equal(panels.openPartId(), 'bme');
    panels.refreshPart('bme', { address: '0x77' });
    assert.equal(select.value, '0x77');
    assert.deepEqual(changes, [['address', '0x76']]);
    panels.refreshPart('bme', null);
    assert.equal(/** @type {HTMLElement} */ (dom.window.document.querySelector('#wire-menu')).hidden, true);
    assert.equal(panels.openPartId(), null);
    panels.partMenu('button', 10, 10, DEVICES['push-button'].properties, { pressed: false }, null, (key, value) => changes.push([key, value]));
    const button = /** @type {HTMLButtonElement} */ (dom.window.document.querySelector('#wire-menu button[aria-label="Hold to press"]'));
    assert.ok(button);
    button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    button.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    assert.deepEqual(changes.slice(1), [['pressed', true], ['pressed', false]]);
    button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    /** @type {string[]} */
    const colours = [];
    panels.wireMenu('w1', 10, 10, { color: value => colours.push(value), remove() {} });
    assert.deepEqual(changes.slice(-2), [['pressed', true], ['pressed', false]]);
    panels.partMenu('button', 10, 10, DEVICES['push-button'].properties, { pressed: false }, null, (key, value) => changes.push([key, value]));
    const again = /** @type {HTMLButtonElement} */ (dom.window.document.querySelector('#wire-menu button[aria-label="Hold to press"]'));
    again.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepEqual(changes.slice(-2), [['pressed', true], ['pressed', false]]);
    panels.wireMenu('w1', 10, 10, { color: value => colours.push(value), remove() {} });
    const blue = /** @type {HTMLButtonElement} */ (dom.window.document.querySelector('#wire-menu button[aria-label="Blue"]'));
    blue.click();
    assert.deepEqual(colours, ['#2f6fd0']);
  } finally {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.addEventListener = previous.addEventListener;
    dom.window.close();
  }
});

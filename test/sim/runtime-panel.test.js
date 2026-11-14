import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createRuntimePanel } from '../../sim/ui/device-runtime-panel.js';

function setup() {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  /** @type {any[]} */ const changes = [];
  const panel = createRuntimePanel({ lang: 'en', change: (target, values) => changes.push([target, values]) });
  return { dom, previous, panel, changes };
}
/** @param {any} element @param {string} type */
function fire(element, type) {
  element.dispatchEvent(new (/** @type {any} */ (element).ownerDocument.defaultView).Event(type, { bubbles: true }));
}
test('the servo panel reports the commanded angle', () => {
  const { dom, previous, panel, changes } = setup();
  try {
    panel.show({ kind: 'servo', id: 'servo' });
    const angle = /** @type {HTMLInputElement} */ (panel.element.querySelector('input[type="range"]'));
    angle.value = '120';
    fire(angle, 'input');
    assert.deepEqual(changes.at(-1), [{ kind: 'servo', id: 'servo' }, { angle: 120 }]);
  } finally { globalThis.document = previous; dom.window.close(); }
});
test('the motor panel reports direction, speed and load', () => {
  const { dom, previous, panel, changes } = setup();
  try {
    panel.show({ kind: 'motor', id: 'motor', driverId: 'drv' });
    const direction = /** @type {HTMLSelectElement} */ (panel.element.querySelector('select'));
    direction.value = 'forward';
    fire(direction, 'change');
    assert.equal(changes.at(-1)[0].id, 'drv');
    assert.equal(changes.at(-1)[1].direction, 'forward');
    const load = /** @type {HTMLSelectElement} */ (panel.element.querySelectorAll('select')[1]);
    load.value = 'stall';
    fire(load, 'change');
    assert.equal(changes.at(-1)[1].load, 'stall');
  } finally { globalThis.document = previous; dom.window.close(); }
});
test('the strip panel reports colour and pixel count', () => {
  const { dom, previous, panel, changes } = setup();
  try {
    panel.show({ kind: 'strip', id: 'strip' });
    const color = /** @type {HTMLSelectElement} */ (panel.element.querySelector('select'));
    color.value = 'red';
    fire(color, 'change');
    assert.equal(changes.at(-1)[1].color, 'red');
    const pixels = /** @type {HTMLInputElement} */ (panel.element.querySelector('input[type="range"]'));
    pixels.value = '3';
    fire(pixels, 'input');
    assert.equal(changes.at(-1)[1].pixels, 3);
  } finally { globalThis.document = previous; dom.window.close(); }
});
test('the display and button panels expose their controls', () => {
  const { dom, previous, panel, changes } = setup();
  try {
    panel.show({ kind: 'display', id: 'oled' });
    assert.equal(panel.element.querySelectorAll('input[type="range"]').length, 3);
    panel.show({ kind: 'button', id: 'btn' });
    const pressed = /** @type {HTMLInputElement} */ (panel.element.querySelector('input[type="checkbox"]'));
    pressed.checked = true;
    fire(pressed, 'change');
    assert.deepEqual(changes.at(-1), [{ kind: 'button', id: 'btn' }, { pressed: true }]);
    panel.hide();
    assert.equal(panel.element.hidden, true);
  } finally { globalThis.document = previous; dom.window.close(); }
});

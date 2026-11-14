import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { createPropertyEditor } from '../../sim/ui/property-editor.js';

test('property controls enforce bounds and accept enum, boolean and keyboard changes', () => {
  const dom = new JSDOM('<!doctype html>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    /** @type {import('../../sim/devices/catalog.js').DeviceDef['properties']} */
    const schema = { ohms: { kind: 'number', default: 220, min: 1, max: 1000, step: 1, unit: 'Ω' }, address: { kind: 'enum', default: '0x77', values: ['0x76', '0x77'] }, enabled: { kind: 'boolean', default: false } };
    /** @type {[string, number|string|boolean][]} */
    const changes = [];
    const editor = createPropertyEditor(schema, { ohms: 220, address: '0x77', enabled: false }, (key, value) => changes.push([key, value]));
    dom.window.document.body.append(editor.element);
    const number = /** @type {HTMLInputElement} */ (editor.element.querySelector('input[type=number]'));
    const select = /** @type {HTMLSelectElement} */ (editor.element.querySelector('select'));
    const check = /** @type {HTMLInputElement} */ (editor.element.querySelector('input[type=checkbox]'));
    assert.match(number.labels?.[0].textContent ?? '', /ohms.*Ω/);
    assert.match(select.labels?.[0].textContent ?? '', /address/);
    number.value = '1001'; number.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(changes, []);
    number.value = '330'; number.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    select.value = '0x76'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    check.click();
    assert.deepEqual(changes, [['ohms', 330], ['address', '0x76'], ['enabled', true]]);
    editor.update({ ohms: 470, address: '0x77', enabled: false });
    assert.equal(number.value, '470');
    assert.equal(select.value, '0x77');
    assert.equal(check.checked, false);
    assert.equal(changes.length, 3);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

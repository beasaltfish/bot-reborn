import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { emptyBench, addWire } from '../../sim/bench.js';
import { describeSelection } from '../../sim/selection.js';
import { createContextPanel } from '../../sim/ui/context-panel.js';

test('pin and wire context actions retain point, id, color and accessible labels', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    let bench = addWire(emptyBench(), 'esp:3V3', 'mic:VDD', '#d23a2e');
    /** @type {string[]} */
    const events = [];
    const panel = createContextPanel({ lang: 'en', startWire: point => events.push(`start:${point}`), recolorWire: (id, color) => events.push(`${id}:${color}`), removeWire: id => events.push(`remove:${id}`) });
    dom.window.document.body.append(panel.element);
    const pin = /** @type {const} */ ({ kind: 'pin', point: 'mic:VDD' });
    panel.show({ selection: pin, info: describeSelection(bench, pin, 'en') });
    assert.match(panel.element.textContent ?? '', /Supply \+/);
    const start = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button[data-action="start-wire"]'));
    assert.equal(start.textContent, 'Start wire');
    start.click();
    assert.deepEqual(events, ['start:mic:VDD']);
    const wire = /** @type {const} */ ({ kind: 'wire', id: bench.wires[0].id });
    panel.show({ selection: wire, info: describeSelection(bench, wire, 'en'), color: bench.wires[0].color });
    assert.match(panel.element.textContent ?? '', /esp:3V3/);
    panel.element.getBoundingClientRect = () => /** @type {DOMRect} */ ({ width: 290, height: 240 });
    panel.position(990, 730, 1280, 800);
    assert.equal(panel.element.style.left, '982px');
    assert.equal(panel.element.style.top, '552px');
    const red = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button[aria-label="Red"]'));
    assert.equal(red.getAttribute('aria-pressed'), 'true');
    for (const button of panel.element.querySelectorAll('button[data-color]')) /** @type {HTMLButtonElement} */ (button).click();
    assert.equal(events.length, 9);
    assert.equal(events[1], `${wire.id}:#d23a2e`);
    const remove = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button[data-action="remove-wire"]'));
    remove.click();
    assert.equal(events.at(-1), `remove:${wire.id}`);
    const close = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button[data-action="close"]'));
    assert.ok(close);
    close.click();
    assert.equal(panel.element.hidden, true);
  } finally {
    globalThis.document = previous;
    dom.window.close();
  }
});

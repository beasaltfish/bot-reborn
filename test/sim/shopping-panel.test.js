import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createShoppingPanel } from '../../sim/ui/shopping-panel.js';
import { emptyBench } from '../../sim/bench.js';

test('the list names every line in the chosen language and totals in dollars', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const panel = createShoppingPanel({ lang: 'zh', bench: () => emptyBench() });
    dom.window.document.body.append(panel.element);
    panel.render();
    const rows = [...panel.element.querySelectorAll('[data-part]')];
    assert.ok(rows.length >= 4);
    assert.match(rows[0].textContent ?? '', /ESP32/);
    assert.match(panel.element.textContent ?? '', /USD|美元/);
    assert.match(panel.element.textContent ?? '', /杜邦线/);
    assert.equal(panel.element.querySelectorAll('[data-warning]').length, 0);
  } finally {
    globalThis.document = previous;
  }
});

test('a warning row explains itself and the print button is there', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const bench = emptyBench();
    const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
      { id: 'scr', part: 'screen-st7735-160', at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false, properties: {} },
    ]);
    const panel = createShoppingPanel({ lang: 'en', bench: () => ({ ...bench, placed }) });
    dom.window.document.body.append(panel.element);
    panel.render();
    const warning = panel.element.querySelector('[data-warning]');
    assert.equal(warning?.getAttribute('data-warning'), 'screen-unsupported-controller');
    assert.match(warning?.textContent ?? '', /driver/i);
    assert.ok(panel.element.querySelector('[data-action="print"]'));
  } finally {
    globalThis.document = previous;
  }
});

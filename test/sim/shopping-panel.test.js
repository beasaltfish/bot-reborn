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

test('each line shows the value to name, the search words and an alternative', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const bench = emptyBench();
    const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
      { id: 'r1', part: 'resistor', at: { x: 2, z: 0 }, rot: 0, seated: false, burnt: false, properties: { ohms: 1000 } },
    ]);
    const panel = createShoppingPanel({ lang: 'en', bench: () => ({ ...bench, placed }) });
    dom.window.document.body.append(panel.element);
    panel.render();
    const row = panel.element.querySelector('[data-part="resistor|1000"]');
    assert.match(row?.textContent ?? '', /1000 Ω/);
    assert.match(row?.textContent ?? '', /carbon film resistor/i);
    assert.match(row?.textContent ?? '', /metal film/i);
  } finally {
    globalThis.document = previous;
  }
});

test('a project-only part is marked as something the project needs', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const plan = /** @type {any} */ ({ id: 'button-led', name: 'Button and LED', parts: [], links: [], steps: [
      { kind: 'part', id: 'btn', part: 'button-module', at: { x: 0, z: 0 }, rot: 0, seated: false },
    ] });
    const panel = createShoppingPanel({ lang: 'en', bench: () => emptyBench(), plan: () => plan });
    dom.window.document.body.append(panel.element);
    panel.render();
    const row = panel.element.querySelector('[data-part="button-module"]');
    assert.ok(row);
    assert.match(row.textContent ?? '', /project/i);
  } finally {
    globalThis.document = previous;
  }
});

test('a different project screen is named instead of adding a second screen line', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const bench = { ...emptyBench(), placed: /** @type {any} */ ([
      { id: 'scr', part: 'screen-st7735-160', at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false, properties: {} },
    ]) };
    const plan = /** @type {any} */ ({ id: 'tarot', name: 'Tarot', parts: [], links: [], steps: [
      { kind: 'part', id: 'scr', part: 'screen-ili9341-ips', at: { x: 0, z: 0 }, rot: 0, seated: false },
    ] });
    const panel = createShoppingPanel({ lang: 'en', bench: () => bench, plan: () => plan });
    dom.window.document.body.append(panel.element);
    panel.render();
    assert.equal(panel.element.querySelectorAll('[data-part^="screen-"]').length, 1);
    assert.match(panel.element.textContent ?? '', /ILI9341V 2\.8/);
    assert.match(panel.element.textContent ?? '', /ST7735 1\.8/);
  } finally {
    globalThis.document = previous;
  }
});

test('an unverified panel is described as unverified, not as never lit', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const bench = emptyBench();
    const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
      { id: 'scr', part: 'screen-ili9341-ips', at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false, properties: {} },
    ]);
    const panel = createShoppingPanel({ lang: 'en', bench: () => ({ ...bench, placed }) });
    dom.window.document.body.append(panel.element);
    panel.render();
    const warning = panel.element.querySelector('[data-warning="screen-unverified"]');
    assert.ok(warning);
    assert.match(warning.textContent ?? '', /not marked verified/i);
    assert.doesNotMatch(warning.textContent ?? '', /nobody has/i);
  } finally {
    globalThis.document = previous;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { createSerialPanel } from '../../sim/ui/serial-panel.js';
import { BODY } from '../../sim/firmware/body.js';
import { emptyBoard } from '../../sim/bench.js';

function setup(over = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  const previousFetch = globalThis.fetch;
  globalThis.document = dom.window.document;
  const changes = /** @type {any[]} */ ([]);
  const reboots = /** @type {any[]} */ ([]);
  const panel = createSerialPanel({
    lang: 'en',
    firmware: BODY,
    settings: emptyBoard().settings,
    characters: [{ id: 'rex', name: 'Rex' }],
    onChange: (s) => changes.push(s),
    onReboot: () => reboots.push(true),
    ...over,
  });
  dom.window.document.body.append(panel.element);
  return { dom, panel, changes, reboots, restore: () => { globalThis.document = previous; globalThis.fetch = previousFetch; } };
}

test('the serial panel is hidden until USB is in', () => {
  const { panel, restore } = setup();
  try {
    assert.equal(panel.element.hidden, true);
    panel.show(true);
    assert.equal(panel.element.hidden, false);
    panel.show(false);
    assert.equal(panel.element.hidden, true);
  } finally { restore(); }
});

test('the log keeps the last 200 lines', () => {
  const { panel, restore } = setup();
  try {
    for (let i = 0; i < 250; i++) panel.append(`line ${i}`);
    assert.equal(panel.log.length, 200);
    assert.equal(panel.log[0], 'line 50');
  } finally { restore(); }
});

test('typing show appends the board lines and sends the settings', () => {
  const { panel, changes, restore } = setup();
  try {
    const input = /** @type {HTMLInputElement} */ (panel.element.querySelector('input[data-role="line"]'));
    input.value = 'show';
    /** @type {HTMLFormElement} */ (panel.element.querySelector('form')).dispatchEvent(new (globalThis.document.defaultView?.Event ?? Event)('submit', { bubbles: true, cancelable: true }));
    assert.ok(panel.log.includes('board.end'));
    assert.equal(changes.length, 1);
  } finally { restore(); }
});

test('choosing a character only fills the input with token <hex>', async () => {
  globalThis.fetch = /** @type {any} */ (async () => ({ ok: true, json: async () => ({ token: 'a'.repeat(32) }) }));
  const { panel, changes, restore } = setup();
  try {
    const pick = /** @type {HTMLSelectElement} */ (panel.element.querySelector('select[data-role="character"]'));
    pick.value = 'rex';
    pick.dispatchEvent(new (globalThis.document.defaultView?.Event ?? Event)('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const input = /** @type {HTMLInputElement} */ (panel.element.querySelector('input[data-role="line"]'));
    assert.equal(input.value, `token ${'a'.repeat(32)}`);
    assert.equal(changes.length, 0);
  } finally { restore(); }
});

test('type() sends a line the way the input form would', () => {
  const { panel, changes, restore } = setup();
  try {
    panel.type('show');
    assert.ok(panel.log.includes('board.end'));
    assert.equal(changes.length, 1);
  } finally { restore(); }
});

test('the character helper can be filled later and hidden for a remote brain', () => {
  const { panel, restore } = setup({ characters: [] });
  try {
    const pick = /** @type {HTMLElement} */ (panel.element.querySelector('label'));
    panel.setCharacters([{ id: 'ada', name: 'Ada' }]);
    const select = /** @type {HTMLSelectElement} */ (panel.element.querySelector('select[data-role="character"]'));
    assert.deepEqual([...select.options].map((o) => o.value), ['', 'ada']);
    panel.setCharacterHelper(false);
    assert.equal(pick.hidden, true);
    panel.setCharacterHelper(true);
    assert.equal(pick.hidden, false);
  } finally { restore(); }
});

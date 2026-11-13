import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createLessonPanel } from '../../sim/ui/lesson-panel.js';
import { BUTTON_LESSON } from '../../sim/lessons/button.js';
import { POWER_LESSON } from '../../sim/lessons/power.js';
import { PROFILES } from '../../sim/devices/profiles.js';
import { validateLesson } from '../../sim/lessons/schema.js';
import { DEVICES } from '../../sim/devices/catalog.js';
import { PROJECTS } from '../../sim/projects.js';

function store() {
  const data = new Map();
  return { getItem: (/** @type {string} */ key) => data.get(key) ?? null, setItem: (/** @type {string} */ key, /** @type {string} */ value) => data.set(key, value) };
}
/** @param {import('../../sim/lessons/schema.js').Lesson} lesson @param {(name:string,value:string)=>void} [onControl] */
function panel(lesson, onControl) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  return { dom, previous, made: createLessonPanel({ lesson, store: store(), lang: 'en', onControl }) };
}
/** @param {any} element @param {string} selector */
function change(element, selector) {
  const found = element.querySelector(selector);
  assert.ok(found, selector);
  found.checked = true;
  found.dispatchEvent(new (/** @type {any} */ (found).ownerDocument.defaultView).Event('change', { bubbles: true }));
}
/** @param {any} element @param {string} selector */
function click(element, selector) {
  const found = element.querySelector(selector);
  assert.ok(found, selector);
  found.dispatchEvent(new (/** @type {any} */ (found).ownerDocument.defaultView).MouseEvent('click', { bubbles: true }));
}

test('the generic panel walks the five button-module stages', () => {
  /** @type {[string,string][]} */ const seen = [];
  const { dom, previous, made } = panel(BUTTON_LESSON, (name, value) => seen.push([name, value]));
  try {
    const root = made.element;
    assert.match(root.querySelector('h2')?.textContent ?? '', /^1\/5/);
    click(root, 'button[data-action="acknowledge"]');
    assert.equal(root.querySelector('[role="status"]')?.textContent, 'Completed');
    click(root, 'button[data-action="next"]');
    for (const pin of ['S', 'VCC', 'GND']) click(root, `button[data-pin="${pin}"]`);
    click(root, 'button[data-action="next"]');
    const project = PROJECTS.find(item => item.id === 'button-led');
    assert.ok(project);
    for (let i = 0; i < project.links.length; i++) click(root, `button[data-wire="${i}"]`);
    click(root, 'button[data-action="next"]');
    change(root, '[data-control="pressed"]');
    assert.equal(seen.at(-1)?.[0], 'pressed');
    click(root, 'button[data-action="next"]');
    click(root, 'button[data-fault="logic-level-incompatible"]');
    click(root, 'button[data-fault="floating-input"]');
    assert.equal(root.querySelector('[role="status"]')?.textContent, 'Completed');
    made.setLanguage('zh');
    assert.match(root.getAttribute('aria-label') ?? '', /按键输入基础/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('the power lesson exposes chemistry and charge controls', () => {
  const { dom, previous, made } = panel(POWER_LESSON);
  try {
    const root = made.element;
    for (let i = 0; i < 3; i++) click(root, 'button[data-action="next"]');
    assert.ok(root.querySelector('select[data-control="chemistry"]'));
    assert.ok(root.querySelector('input[data-control="charge"]'));
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('the generic lesson content still validates against the catalogue', () => {
  for (const lesson of [BUTTON_LESSON, POWER_LESSON]) assert.deepEqual(validateLesson(lesson, DEVICES, PROJECTS), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { createProjectPanel } from '../../sim/ui/project-panel.js';
import { projectById } from '../../sim/projects.js';
import { connectionProgress } from '../../sim/project-progress.js';
import { emptyBench, addWire } from '../../sim/bench.js';
import { describeSelection } from '../../sim/selection.js';

test('guided checklist exposes textual states and focuses exact connection endpoints', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const project = projectById('audio');
    assert.ok(project);
    let bench = { ...emptyBench(), usb: true };
    bench = addWire(bench, 'mic:VDD', 'esp:3V3', 'red');
    bench = addWire(bench, 'esp:3V3', 'esp:GND', 'red');
    const progress = connectionProgress(bench, project);
    /** @type {string[][]} */ const focused = [];
    const panel = createProjectPanel({ lang: 'en', focus: points => focused.push(points) });
    dom.window.document.body.append(panel.element);
    panel.render({ mode: 'guided', project, progress, selection: null, diagnoses: [] });
    const rows = [...panel.element.querySelectorAll('[data-status]')];
    assert.equal(rows[0].getAttribute('data-status'), 'fault');
    assert.match(rows[0].textContent ?? '', /fault/i);
    assert.match(rows[0].textContent ?? '', /short-rails/);
    assert.equal(rows[0].querySelector('[aria-label="Fault"]')?.getAttribute('aria-label'), 'Fault');
    assert.ok(rows.some(row => row.getAttribute('data-status') === 'missing'));
    const show = /** @type {HTMLButtonElement} */ (rows[0].querySelector('button'));
    assert.match(show.textContent ?? '', /Show me/);
    assert.equal(show.getAttribute('aria-label'), 'Show me: mic:VDD → esp:3V3');
    show.focus();
    show.click();
    assert.deepEqual(focused, [['mic:VDD', 'esp:3V3']]);
    panel.render({ mode: 'guided', project, progress, selection: null, diagnoses: [] });
    assert.equal(dom.window.document.activeElement?.getAttribute('aria-label'), 'Show me: mic:VDD → esp:3V3');
    bench = { ...emptyBench(), usb: false };
    bench = addWire(bench, 'mic:VDD', 'esp:3V3', 'red');
    panel.render({ mode: 'guided', project, progress: connectionProgress(bench, project), selection: null, diagnoses: [] });
    assert.equal(panel.element.querySelector('[data-status]')?.getAttribute('data-status'), 'complete');
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('guided Chinese explanations follow the actual screen variant rather than link order', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const project = projectById('screen', { screenId: 'st7735-160', wand: true });
    assert.ok(project);
    const panel = createProjectPanel({ lang: 'zh', focus() {} });
    panel.render({ mode: 'guided', project, progress: connectionProgress(emptyBench(), project), selection: null, diagnoses: [] });
    const rows = [...panel.element.querySelectorAll('[data-status]')];
    assert.match(rows[0].textContent ?? '', /麦克风额定电压最高为 3\.6 V/);
    const screenClock = rows.find(row => (row.textContent ?? '').includes('scr:SCK'));
    assert.ok(screenClock);
    assert.match(screenClock.textContent ?? '', /屏幕时钟连接 GPIO 11/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('free mode shows the selection and diagnoses without asserting a correct circuit', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    /** @type {string[][]} */ const focused = [];
    const panel = createProjectPanel({ lang: 'zh', focus: points => focused.push(points) });
    const selection = describeSelection(emptyBench(), { kind: 'pin', point: 'mic:VDD' }, 'zh');
    panel.render({ mode: 'free', project: null, progress: [], selection, diagnoses: [{ kind: 'fault', text: 'Fault explanation', points: ['mic:VDD'] }] });
    assert.match(panel.element.textContent ?? '', /mic:VDD/);
    assert.match(panel.element.textContent ?? '', /Fault explanation/);
    assert.doesNotMatch(panel.element.textContent ?? '', /complete|正确电路/i);
    const button = /** @type {HTMLButtonElement} */ (panel.element.querySelector('button[aria-label="查看位置: mic:VDD"]'));
    assert.ok(button);
    button.click();
    assert.deepEqual(focused, [['mic:VDD']]);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('a connection with a missing part cannot be focused', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const project = projectById('toy');
    assert.ok(project);
    const panel = createProjectPanel({ lang: 'en', focus() {} });
    panel.render({ mode: 'guided', project, progress: connectionProgress(emptyBench(), project), selection: null, diagnoses: [] });
    const row = [...panel.element.querySelectorAll('[data-status]')].find(item => (item.textContent ?? '').includes('toy:U3A'));
    assert.ok(row);
    const button = /** @type {HTMLButtonElement} */ (row.querySelector('button'));
    assert.equal(button.disabled, true);
    assert.equal(button.title, 'Place the parts first');
    assert.equal(row.getAttribute('data-missing'), 'true');
    assert.match(row.textContent ?? '', /Missing: toy/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('project and diagnostics are separate tabs and leaving clears the plan', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    let leaves = 0;
    /** @type {string|null} */ let built = null;
    const project = projectById('power-a-rail');
    assert.ok(project);
    const panel = createProjectPanel({ lang: 'en', focus() {}, leave: () => { leaves += 1; }, build: id => { built = id; } });
    /** @type {any} */ const guided = { mode: 'guided', project, progress: connectionProgress(emptyBench(), project), selection: null, diagnoses: [] };
    /** @type {any} */ const free = { mode: 'free', evaluated: true, project: null, progress: [], selection: null, diagnoses: [{ kind: 'fault', text: 'A free-mode fault', points: [] }] };
    panel.render(guided, free);
    const tabs = [...panel.element.querySelectorAll('[data-tab]')];
    assert.deepEqual(tabs.map((/** @type {any} */ tab) => tab.dataset.tab), ['project', 'diagnostics']);
    assert.ok(panel.element.querySelector('[data-status]'));
    assert.match(panel.element.textContent ?? '', /battery through a regulator/);
    assert.doesNotMatch(panel.element.textContent ?? '', /project\.goal\./);
    tabs[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.match(panel.element.textContent ?? '', /A free-mode fault/);
    assert.equal(panel.element.querySelector('[data-status]'), null);
    tabs[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const build = /** @type {HTMLButtonElement} */ (panel.element.querySelector('[data-action="build"]'));
    assert.ok(build);
    build.click();
    assert.equal(built, 'power-a-rail');
    const leave = /** @type {HTMLButtonElement} */ (panel.element.querySelector('[data-action="leave"]'));
    assert.ok(leave);
    leave.click();
    assert.equal(leaves, 1);
    panel.render({ ...guided, project: null, mode: 'free' }, { ...free, evaluated: false, diagnoses: [] });
    assert.match(panel.element.textContent ?? '', /Plug in USB/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createLabActions } from '../../sim/ui/lab-actions.js';

test('lab actions navigate only after successfully queuing and localize both actions', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    /** @type {import('../../sim/lab-handoff.js').Request[]} */ const requests = [];
    let navigations = 0, errors = 0, allowed = false;
    const actions = createLabActions({ part: 'led-5mm', projectId: 'led-basics', enqueue: request => { requests.push(request); return allowed; }, navigate: () => { navigations++; }, onError: () => { errors++; } });
    document.body.append(actions.element);
    const buttons = actions.element.querySelectorAll('button');
    assert.equal(buttons.length, 2);
    buttons[0].click();
    assert.equal(errors, 1);
    assert.equal(navigations, 0);
    allowed = true;
    actions.setLanguage('zh');
    assert.match(buttons[0].textContent ?? '', /添加/);
    assert.match(buttons[1].textContent ?? '', /项目/);
    buttons[1].click();
    assert.deepEqual(requests.at(-1), { kind: 'project', projectId: 'led-basics' });
    assert.equal(navigations, 1);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('project action captures the current example address at click time', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    /** @type {'0x76'|'0x77'} */ let address = '0x77';
    /** @type {import('../../sim/lab-handoff.js').Request|null} */ let queued = null;
    const actions = createLabActions({ part: 'bme280-i2c', projectId: 'bme280-readings', projectAddress: () => address, enqueue: request => { queued = request; return true; }, navigate() {}, onError() {} });
    address = '0x76';
    /** @type {HTMLButtonElement} */ (actions.element.querySelectorAll('button')[1]).click();
    assert.deepEqual(queued, { kind: 'project', projectId: 'bme280-readings', address: '0x76' });
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('controller and unknown parts do not offer unsupported actions', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const actions = createLabActions({ part: null, projectId: null, enqueue: () => true, navigate() {}, onError() {} });
    assert.equal(actions.element.querySelectorAll('button').length, 0);
  } finally { globalThis.document = previous; dom.window.close(); }
});

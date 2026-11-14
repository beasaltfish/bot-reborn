import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createWiringOverview } from '../../sim/ui/wiring-overview.js';
import { planById } from '../../sim/plan.js';

test('a new project gets an auto-layout diagram, not a text list', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const plan = planById('power-a-rail');
    assert.ok(plan);
    const view = createWiringOverview(plan);
    assert.ok(view.querySelector('svg'));
    assert.equal(view.querySelectorAll('svg path').length, plan.links.length);
    assert.equal(view.dataset.layout, 'auto');
    assert.match(view.textContent ?? '', /battery/i);
    assert.match(view.textContent ?? '', /regulator/i);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('a plan without links falls back to an empty list', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const plan = planById('power-a-rail');
    assert.ok(plan);
    const view = createWiringOverview({ ...plan, links: [] });
    assert.equal(view.dataset.layout, 'false');
    assert.equal(view.querySelector('svg'), null);
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('a legacy recipe keeps its schematic layout', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const plan = planById('audio');
    assert.ok(plan);
    const view = createWiringOverview(plan);
    assert.ok(view.querySelector('svg'));
    assert.ok((view.querySelectorAll('svg path').length) >= 10);
    assert.equal(view.dataset.layout, 'true');
  } finally { globalThis.document = previous; dom.window.close(); }
});

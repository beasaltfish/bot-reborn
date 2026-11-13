import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { createWiringOverview } from '../../sim/ui/wiring-overview.js';
import { planById } from '../../sim/plan.js';

test('a new project gets a link-list overview, not the legacy schematic', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const plan = planById('power-a-rail');
    assert.ok(plan);
    const view = createWiringOverview(plan);
    assert.match(view.textContent ?? '', /bat:\+.*reg:VIN/);
    assert.equal(view.querySelector('svg path'), null);
    assert.equal(view.dataset.layout, 'false');
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

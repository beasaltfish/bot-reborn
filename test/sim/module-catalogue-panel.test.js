// A brain that cannot be read is a sentence in the project panel, not an empty
// dropdown: the person has to know the difference between "no modules" and
// "the brain did not answer".

import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { createProjectPanel } from '../../sim/ui/project-panel.js';

test('the project panel says why the catalogue is missing', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const panel = createProjectPanel({ lang: 'en', focus() {}, note: 'The module catalogue could not be read.' });
    panel.render({ mode: 'free', project: null, progress: [], selection: null, diagnoses: [] });
    assert.match(panel.element.textContent ?? '', /module catalogue could not be read/);
    const absent = createProjectPanel({ lang: 'en', focus() {} });
    absent.render({ mode: 'free', project: null, progress: [], selection: null, diagnoses: [] });
    assert.doesNotMatch(absent.element.textContent ?? '', /catalogue could not be read/);
  } finally { globalThis.document = previous; dom.window.close(); }
});

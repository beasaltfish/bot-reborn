import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom does not include type declarations
import { JSDOM } from 'jsdom';
import { isViewPeekShortcut } from '../../sim/view-shortcut.js';

test('space peeks on the bench but not while using interactive controls', () => {
  const dom = new JSDOM('<canvas></canvas><button><span>Hold</span></button><select><option>one</option></select><input><textarea></textarea><a href="#">Link</a><div contenteditable="true">Edit</div>');
  try {
    const event = (/** @type {string} */ selector) => {
      const target = dom.window.document.querySelector(selector);
      assert.ok(target);
      const key = new dom.window.KeyboardEvent('keydown', { code: 'Space', bubbles: true });
      target.dispatchEvent(key);
      return key;
    };
    assert.equal(isViewPeekShortcut(event('canvas')), true);
    for (const selector of ['button span', 'select', 'input', 'textarea', 'a', '[contenteditable]']) {
      assert.equal(isViewPeekShortcut(event(selector)), false, selector);
    }
  } finally { dom.window.close(); }
});

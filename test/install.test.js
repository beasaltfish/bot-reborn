import test from 'node:test';
import assert from 'node:assert/strict';
import { offerInstall } from '../web/install.js';

/** A window and a button, as far as offerInstall can tell. */
function setup() {
  const win = new EventTarget();
  const button = Object.assign(new EventTarget(), { hidden: true });
  offerInstall(/** @type {any} */ (button), /** @type {any} */ (win));
  /** @type {string[]} */ const calls = [];
  const offer = () => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, { prompt: async () => void calls.push('prompt') });
    win.dispatchEvent(e);
    return e;
  };
  return { win, button, calls, offer };
}

test('no offer from the browser, no button', () => {
  const { button } = setup();
  assert.equal(button.hidden, true);
});

test('the browser says it can be installed: the button appears', () => {
  const { button, offer } = setup();
  const e = offer();
  assert.equal(button.hidden, false);
  assert.equal(e.defaultPrevented, true, 'our button instead of Chrome\'s own bar');
});

test('pressing it opens the install dialog once, and the button goes', async () => {
  const { button, calls, offer } = setup();
  offer();
  button.dispatchEvent(new Event('click'));
  button.dispatchEvent(new Event('click'));
  await Promise.resolve();
  assert.deepEqual(calls, ['prompt'], 'an offer can only be used once');
  assert.equal(button.hidden, true);
});

test('installed some other way: the button goes', () => {
  const { win, button, offer } = setup();
  offer();
  win.dispatchEvent(new Event('appinstalled'));
  assert.equal(button.hidden, true);
});

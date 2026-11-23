// The project panel's four answers about the character on the other end, as a
// pure function: pairing nothing, already this body, this body without its
// actions, and a different body altogether.

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStep } from '../../sim/body-next-step.js';

const asten = (/** @type {string} */ bodyId, /** @type {string[]} */ actionNames = []) => ({ name: 'Asten', bodyId, actionNames });

test('an empty bench says nothing', () => {
  assert.equal(nextStep({ body: null, character: asten('toy') }), null);
});

test('a demo with no paired character asks for one', () => {
  const out = nextStep({ body: 'led-module', character: null, installed: true });
  assert.equal(out?.key, 'bodyNext.pair');
  assert.equal(out?.action, null);
});

test('this body with its tools is the end of the story', () => {
  const out = nextStep({ body: 'led-module', installed: true, character: asten('led-module', ['light_up']) });
  assert.equal(out?.key, 'bodyNext.isBody');
  assert.equal(out?.action, null);
});

test('this body without its actions offers them, as a body switch', () => {
  const out = nextStep({ body: 'led-module', installed: true, character: asten('led-module'), examples: 2 });
  assert.equal(out?.key, 'bodyNext.needsActions');
  assert.equal(out?.action, 'adopt');
  assert.equal(out?.params.n, 2);
});

test('an uninstalled body offers the install', () => {
  const out = nextStep({ body: 'led-module', installed: false, character: asten('toy'), examples: 2 });
  assert.equal(out?.key, 'bodyNext.notInstalled');
  assert.equal(out?.action, 'install');
});

test('the wrong actions on the right body still offer the switch', () => {
  // A toy's play_sound is not the LED module's light_up; counting actions would
  // call that "done" and leave the model without the tool the demo is about.
  const out = nextStep({
    body: 'led-module', installed: true, examples: ['light_up', 'light_down'],
    character: asten('led-module', ['play_sound']),
  });
  assert.equal(out?.key, 'bodyNext.needsActions');
  assert.equal(out?.action, 'adopt');
});

test('another body on the character offers the switch, and says so', () => {
  const out = nextStep({ body: 'led-module', installed: true, character: asten('tarot', ['draw_card']), examples: 2 });
  assert.equal(out?.key, 'bodyNext.otherBody');
  assert.equal(out?.action, 'adopt');
  assert.equal(out?.params.name, 'Asten');
});

// Every demo that builds a robot names the body it builds. A bench lesson
// builds a circuit, not a robot, and names none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { projectById } from '../../sim/projects.js';

/** @param {string} id */
const bodyOf = (id) => /** @type {any} */ (projectById(id))?.body;

test('the four demo builds name their body', () => {
  assert.equal(bodyOf('audio'), 'none');
  assert.equal(bodyOf('screen'), 'pet');
  assert.equal(bodyOf('toy'), 'toy');
  // Adapted from the screen recipe and given a wand; the body is its own.
  assert.equal(bodyOf('tarot'), 'tarot');
});

test('a bench lesson is not a body', () => {
  assert.equal(bodyOf('led-basics'), undefined);
  assert.equal(bodyOf('power-a-rail'), undefined);
});

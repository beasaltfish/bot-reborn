import test from 'node:test';
import assert from 'node:assert/strict';
import { createButtonLabExample } from '../../sim/lessons/button-example.js';

test('button example uses explicit hypothetical pull and momentary contact', () => {
  const example = createButtonLabExample();
  assert.equal(example.evaluate().states['esp:GPIO4'], 'high');
  example.press(true);
  assert.equal(example.evaluate().states['esp:GPIO4'], 'low');
  example.press(false);
  assert.equal(example.evaluate().states['esp:GPIO4'], 'high');
  example.setPull('none');
  assert.equal(example.evaluate().states['esp:GPIO4'], 'floating');
  example.press(true);
  assert.equal(example.evaluate().states['esp:GPIO4'], 'low');
});

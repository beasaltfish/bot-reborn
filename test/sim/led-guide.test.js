import test from 'node:test';
import assert from 'node:assert/strict';
import { ledGuide } from '../../sim/led-guide.js';

test('LED guide describes a safe circuit in both languages', () => {
  assert.equal(ledGuide('en').length, 4);
  assert.equal(ledGuide('zh').length, 4);
  assert.match(ledGuide('en').join(' '), /220 Ω/);
  assert.match(ledGuide('zh').join(' '), /220 Ω/);
  assert.match(ledGuide('en').join(' '), /always on/);
  assert.match(ledGuide('zh').join(' '), /开启/);
});

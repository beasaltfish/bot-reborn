import test from 'node:test';
import assert from 'node:assert/strict';
import { previewStates, previewText } from '../../sim/project-preview.js';

test('device projects preview their result', () => {
  const servo = previewStates('proximity-servo');
  assert.equal(servo?.servo?.servo?.angle, 45);
  const motor = previewStates('motor-driver-basics');
  assert.equal(motor?.motor?.motor?.rpmRatio, 0.5);
  const strip = previewStates('status-light-strip');
  assert.equal(strip?.strip?.strip?.colors.length, 8);
  const display = previewStates('environment-display');
  assert.ok(display?.display?.oled?.frame?.length);
  assert.equal(previewStates('led-basics'), null);
});

test('preview copy is bilingual and only where a result exists', () => {
  assert.match(previewText('proximity-servo', 'en') ?? '', /45/);
  assert.match(previewText('proximity-servo', 'zh') ?? '', /45/);
  assert.equal(previewText('audio', 'en'), null);
});

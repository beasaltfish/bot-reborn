import test from 'node:test';
import assert from 'node:assert/strict';
import { previewText } from '../../sim/project-preview.js';

test('preview copy explains the result, without faking device state', () => {
  assert.match(previewText('proximity-servo', 'en') ?? '', /level-shift/);
  assert.match(previewText('distance-reader', 'en') ?? '', /no reading/);
  assert.match(previewText('button-led', 'en') ?? '', /button/);
});

test('preview copy is bilingual and only where a result exists', () => {
  assert.match(previewText('proximity-servo', 'zh') ?? '', /电平/);
  assert.equal(previewText('audio', 'en'), null);
});

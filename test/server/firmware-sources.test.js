import test from 'node:test';
import assert from 'node:assert/strict';

import { listFirmwareSources, readFirmwareSource } from '../../server/firmware-sources.js';

test('lists C and H files from firmware/main', () => {
  const files = listFirmwareSources();
  assert.ok(files.includes('main.c'));
  assert.ok(files.every((f) => /\.(c|h)$/.test(f) && !f.includes('/')));
});

test('reads main.c as text', () => assert.match(readFirmwareSource('main.c'), /app_main/));

test('rejects traversal and non-source names', () => {
  assert.throws(() => readFirmwareSource('../package.json'), /invalid/);
  assert.throws(() => readFirmwareSource('main.js'), /invalid/);
  assert.throws(() => readFirmwareSource('nope.c'), /not found/);
});

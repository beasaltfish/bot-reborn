import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsBuild } from '../../server/admin-build.js';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'adminb-'));
  const adminDir = join(root, 'admin');
  const webDir = join(root, 'web');
  mkdirSync(join(adminDir, 'src'), { recursive: true });
  mkdirSync(join(webDir, 'models'), { recursive: true });
  writeFileSync(join(adminDir, 'src', 'App.tsx'), 'x');
  writeFileSync(join(webDir, 'checks.js'), 'x');
  writeFileSync(join(webDir, 'models', 'big.wasm'), 'x');
  return { adminDir, webDir };
}
const at = (/** @type {string} */ f, /** @type {number} */ s) => utimesSync(f, s, s);

test('never built means build', () => {
  assert.equal(needsBuild(tree()), true);
});

test('built after every source means no build; a newer source means build', () => {
  const t = tree();
  mkdirSync(join(t.adminDir, 'dist'));
  const index = join(t.adminDir, 'dist', 'index.html');
  writeFileSync(index, 'x');
  at(join(t.adminDir, 'src', 'App.tsx'), 1000);
  at(join(t.webDir, 'checks.js'), 1000);
  at(join(t.webDir, 'models', 'big.wasm'), 9000);    // models do not count
  at(index, 2000);
  assert.equal(needsBuild(t), false);
  at(join(t.webDir, 'checks.js'), 3000);
  assert.equal(needsBuild(t), true);
});

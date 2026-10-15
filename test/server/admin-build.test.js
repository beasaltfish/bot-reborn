import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsBuild } from '../../server/admin-build.js';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'adminb-'));
  const adminDir = join(root, 'admin');
  const coreDir = join(root, 'core');
  mkdirSync(join(adminDir, 'src'), { recursive: true });
  mkdirSync(join(coreDir, 'models'), { recursive: true });
  writeFileSync(join(adminDir, 'src', 'App.tsx'), 'x');
  writeFileSync(join(coreDir, 'checks.js'), 'x');
  writeFileSync(join(coreDir, 'models', 'big.wasm'), 'x');
  return { adminDir, coreDir };
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
  at(join(t.coreDir, 'checks.js'), 1000);
  at(join(t.coreDir, 'models', 'big.wasm'), 9000);    // models do not count
  at(index, 2000);
  assert.equal(needsBuild(t), false);
  at(join(t.coreDir, 'checks.js'), 3000);
  assert.equal(needsBuild(t), true);
});

test('a failed build is reported and the brain starts anyway', async () => {
  // Bodies do not need the admin page; a missing dev dependency must not keep
  // them from connecting. The page itself then says how to build it (503).
  const { prepareAdmin } = await import('../../server/admin-build.js');
  /** @type {string[]} */ const lines = [];
  const ok = prepareAdmin({
    needsBuild: () => true,
    buildAdmin: () => { throw new Error('vite: command not found'); },
    log: (l) => lines.push(l),
  });
  assert.equal(ok, false);
  assert.match(lines.join('\n'), /vite: command not found/);
  assert.match(lines.join('\n'), /npm run admin:build/);
  assert.equal(prepareAdmin({ needsBuild: () => false, buildAdmin: () => { throw new Error('no'); }, log: () => {} }), true);
});

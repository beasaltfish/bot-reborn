import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsBuild, prepareBuild } from '../../server/build.js';

/** A repo with one source in each page dir and core/, plus files that never count. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'build-'));
  const files = {
    admin: join(root, 'admin', 'src', 'App.tsx'),
    sim: join(root, 'sim', 'main.js'),
    phone: join(root, 'phone', 'app.js'),
    core: join(root, 'core', 'protocol.js'),
    model: join(root, 'core', 'models', 'big.wasm'),
    fixture: join(root, 'core', 'fixtures', 'x.wav'),
    config: join(root, 'vite.config.js'),
  };
  for (const f of Object.values(files)) {
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, 'x');
    utimesSync(f, 1000, 1000);
  }
  return { root, files };
}
const at = (/** @type {string} */ f, /** @type {number} */ s) => utimesSync(f, s, s);
/** @param {string} root */
function built(root) {
  const index = join(root, 'dist', 'admin', 'index.html');
  mkdirSync(join(index, '..'), { recursive: true });
  writeFileSync(index, 'x');
  at(index, 2000);
}

test('never built means build', () => {
  assert.equal(needsBuild({ root: tree().root }), true);
});

test('built after every source means no build', () => {
  const t = tree();
  built(t.root);
  assert.equal(needsBuild({ root: t.root }), false);
});

test('a newer source in any page, core/ or the config means build', () => {
  for (const key of /** @type {const} */ (['admin', 'sim', 'phone', 'core', 'config'])) {
    const t = tree();
    built(t.root);
    at(t.files[key], 3000);
    assert.equal(needsBuild({ root: t.root }), true, key);
  }
});

test('models and fixtures do not count', () => {
  const t = tree();
  built(t.root);
  at(t.files.model, 3000);
  at(t.files.fixture, 3000);
  assert.equal(needsBuild({ root: t.root }), false);
});

test('a failed build stops the brain, with the reason', () => {
  // The phone runs the built pages too: starting on an old dist/ would hand
  // it an old core/ the brain no longer speaks.
  assert.throws(() => prepareBuild({
    needsBuild: () => true,
    build: () => { throw new Error('vite: command not found'); },
    log: () => {},
  }), /vite: command not found/);
});

test('an up-to-date build is left alone', () => {
  let calls = 0;
  prepareBuild({ needsBuild: () => false, build: () => { calls++; }, log: () => {} });
  assert.equal(calls, 0);
});

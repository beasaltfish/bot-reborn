import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installModule, loadModules } from '../../server/modules.js';
import { pluginBodies, registerPlugins } from '../../core/bodies.js';

const REPO_MODULES = fileURLToPath(new URL('../../modules/', import.meta.url));
const LED = JSON.parse(readFileSync(join(REPO_MODULES, 'led-module', 'module.json'), 'utf8'));
const ledManifest = () => structuredClone(LED);

/**
 * A modules directory with one subdirectory per entry. A `null` entry leaves
 * the directory without a module.json; a string is written as-is.
 * @param {Record<string, unknown>} modules
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function tempModules(modules, t) {
  const dir = mkdtempSync(join(tmpdir(), 'modules-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, manifest] of Object.entries(modules)) {
    mkdirSync(join(dir, name));
    if (manifest === null) continue;
    writeFileSync(
      join(dir, name, 'module.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );
  }
  return dir;
}

/**
 * An empty bodies directory, as the installer would find beside the config.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function tempBodies(t) {
  const dir = mkdtempSync(join(tmpdir(), 'module-bodies-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    registerPlugins({});
  });
  return dir;
}

test('the catalogue loads the LED module and reports a broken one', (t) => {
  const dir = tempModules({ 'led-module': ledManifest(), broken: { id: 'Broken' } }, t);
  const { modules, problems } = loadModules(dir);
  assert.deepEqual(Object.keys(modules), ['led-module']);
  assert.equal(modules['led-module'].examples?.length, 2);
  // One line, already prefixed with the directory it read.
  assert.deepEqual(problems, ['module broken: "Broken" is not a module id']);
  assert.match(problems.join('\n'), /broken/);
});

test('a module directory with no manifest and a checkout with no modules are silent', (t) => {
  const dir = tempModules({ 'not-a-module': null }, t);
  writeFileSync(join(dir, 'README.md'), '# not a module\n');
  assert.deepEqual(loadModules(dir), { modules: {}, problems: [] });
  assert.deepEqual(loadModules(join(dir, 'no-such-directory')), { modules: {}, problems: [] });
});

test('the shipped LED module is the catalogue', () => {
  const { modules, problems } = loadModules(REPO_MODULES);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(modules), ['led-module']);
  assert.deepEqual(modules['led-module'], LED);
});

test('install writes only the plugin fields and registers the body', (t) => {
  const dir = tempBodies(t);
  const out = installModule('led-module', { modules: loadModules(REPO_MODULES).modules, bodiesDir: dir });
  if ('error' in out) assert.fail(out.error);
  const written = JSON.parse(readFileSync(join(dir, 'led-module', 'body.json'), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['commands', 'id', 'label', 'parts', 'resources']);
  assert.equal(written.examples, undefined);
  assert.equal(written.id, 'led-module');
  assert.equal(out.body.id, 'led-module');
  assert.equal(out.examples.length, 2);
  assert.equal(pluginBodies()['led-module'].commands?.length, 2);
});

/**
 * The error from a refused install. Fails the test if the install succeeded.
 * @param {ReturnType<typeof installModule>} out
 * @returns {string}
 */
function errorOf(out) {
  if (!('error' in out)) assert.fail('expected the install to be refused');
  return out.error;
}

test('a failed write leaves an already-installed body byte-identical', (t) => {
  const bodiesDir = tempBodies(t);
  const modules = loadModules(REPO_MODULES).modules;
  if ('error' in installModule('led-module', { modules, bodiesDir })) assert.fail('first install failed');
  const file = join(bodiesDir, 'led-module', 'body.json');
  const before = readFileSync(file);

  // A directory where the temporary file must go makes the write fail, with
  // the real body already in place.
  mkdirSync(`${file}.tmp`);
  const out = installModule('led-module', { modules, bodiesDir });

  assert.match(errorOf(out), /cannot write the led-module module/);
  assert.deepEqual(readFileSync(file), before);
  assert.deepEqual(readdirSync(bodiesDir), ['led-module']);
});

test('an unreadable existing body is refused before anything is written', (t) => {
  const bodiesDir = tempBodies(t);
  const modules = loadModules(REPO_MODULES).modules;
  // A directory where `body.json` must be makes the read fail with a non-ENOENT
  // error: that is not a first install, so the install must not overwrite it.
  mkdirSync(join(bodiesDir, 'led-module', 'body.json'), { recursive: true });
  const out = installModule('led-module', { modules, bodiesDir });
  assert.match(errorOf(out), /cannot read the existing led-module body/);
  assert.deepEqual(readdirSync(join(bodiesDir, 'led-module')), ['body.json']);
});

test('a duplicate id from an earlier directory is refused and the old body restored', (t) => {
  const bodiesDir = tempBodies(t);
  const modules = loadModules(REPO_MODULES).modules;
  if ('error' in installModule('led-module', { modules, bodiesDir })) assert.fail('first install failed');
  const file = join(bodiesDir, 'led-module', 'body.json');
  const before = readFileSync(file);

  // `aaa-dup` sorts first, claims the id, and makes the loader refuse the
  // directory this install is about to rewrite.
  mkdirSync(join(bodiesDir, 'aaa-dup'));
  writeFileSync(
    join(bodiesDir, 'aaa-dup', 'body.json'),
    JSON.stringify({ ...ledManifest(), label: { en: 'Other', zh: '另一个' } }),
  );
  const out = installModule('led-module', { modules, bodiesDir });

  assert.match(errorOf(out), /plugin led-module: led-module is already loaded/);
  assert.deepEqual(readFileSync(file), before);
  assert.deepEqual(readdirSync(bodiesDir).sort(), ['aaa-dup', 'led-module']);
  assert.equal(pluginBodies()['led-module']?.label.en, 'Other');
});

test('install refuses an unknown id and a template id', (t) => {
  const bodiesDir = tempBodies(t);
  const modules = loadModules(REPO_MODULES).modules;
  assert.match(errorOf(installModule('none', { modules, bodiesDir })), /not a module/);
  assert.match(errorOf(installModule('not-there', { modules, bodiesDir })), /not a module/);
  // A catalogue with a template's key is still refused, and the request is
  // never joined to the bodies directory.
  assert.match(
    errorOf(installModule('none', { modules: { none: ledManifest() }, bodiesDir })),
    /not a module/,
  );
  assert.match(errorOf(installModule('../led-module', { modules, bodiesDir })), /not a module/);
  // A catalogue key that disagrees with the manifest's own id is not trusted.
  const renamed = { ...modules['led-module'], id: 'other-module' };
  assert.match(
    errorOf(installModule('led-module', { modules: { 'led-module': renamed }, bodiesDir })),
    /not a module/,
  );
  assert.deepEqual(readdirSync(bodiesDir), []);
});

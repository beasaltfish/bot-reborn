import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugins } from '../../server/plugin-bodies.js';
import { TEMPLATES } from '../../core/bodies.js';
import { manifest, pointCommand, pointResources } from '../fixtures/plugin.js';

/**
 * A plugin directory with one subdirectory per entry. A `null` entry leaves the
 * directory without a body.json; a string is written as-is (for broken JSON).
 * @param {Record<string, unknown>} plugins
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function tempPlugins(plugins, t) {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-bodies-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(plugins)) {
    mkdirSync(join(dir, name));
    if (body === null) continue;
    writeFileSync(join(dir, name, 'body.json'), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}

test('a good plugin becomes a body, a broken one is named and skipped', (t) => {
  const dir = tempPlugins({
    'my-servo': {
      id: 'my-servo',
      label: { en: 'Servo', zh: '舵机' },
      parts: ['esp32', 'sg90'],
      resources: pointResources,
      commands: [pointCommand],
    },
    'bad-pin': {
      id: 'bad-pin',
      label: { en: 'Bad', zh: '坏' },
      parts: ['esp32'],
      resources: [],
      commands: [pointCommand],
    },
  }, t);
  const { bodies, problems } = loadPlugins(dir);
  assert.deepEqual(Object.keys(bodies), ['my-servo']);
  assert.equal(bodies['my-servo'].commands?.[0].name, 'point');
  assert.deepEqual(bodies['my-servo'].capabilities, ['hear', 'speak']);
  // Commands name pins; the table that turns `sig` into gpio 5 travels too.
  assert.equal(bodies['my-servo'].resources?.[0].gpio, 5);
  assert.deepEqual(bodies['my-servo'].resources, pointResources);
  assert.match(problems.join('\n'), /bad-pin.*pin/);

  // A plugin is the voice-only body with its own commands: no firmware of its
  // own, no actions yet, and the voice-only words.
  const body = bodies['my-servo'];
  assert.equal(body.firmware, TEMPLATES.none.firmware);
  assert.deepEqual(body.actions, []);
  assert.deepEqual(body.prompts, TEMPLATES.none.prompts);
  assert.deepEqual(body.ways, TEMPLATES.none.ways);
  assert.equal(body.preview, 'voice');
});

test('a directory without body.json, a plain file and a missing directory are skipped in silence', (t) => {
  const dir = tempPlugins({ 'not-a-plugin': null }, t);
  writeFileSync(join(dir, 'README.md'), '# not a plugin\n');
  assert.deepEqual(loadPlugins(dir), { bodies: {}, problems: [] });
  assert.deepEqual(loadPlugins(join(dir, 'no-such-directory')), { bodies: {}, problems: [] });
});

test('broken JSON and a duplicate id are named and skipped', (t) => {
  const dir = tempPlugins({
    'my-servo': manifest('my-servo'),
    'z-copy': manifest('my-servo'),
    broken: '{',
  }, t);
  const { bodies, problems } = loadPlugins(dir);
  assert.deepEqual(Object.keys(bodies), ['my-servo']);
  assert.match(problems.join('\n'), /plugin broken: .*JSON/);
  assert.match(problems.join('\n'), /plugin z-copy: my-servo is already loaded/);
});

test('a plugin may not take a template\'s name', (t) => {
  const dir = tempPlugins({ fake: manifest('pet') }, t);
  const { bodies, problems } = loadPlugins(dir);
  assert.deepEqual(bodies, {});
  assert.match(problems.join('\n'), /plugin fake: pet is a built-in body/);
});

test('a command that cannot run lands in problems with its own phrase', (t) => {
  const dir = tempPlugins({
    'unknown-op': manifest('unknown-op', {
      commands: [{ ...pointCommand, run: [{ op: 'servo', args: {} }] }],
    }),
    'no-safe': manifest('no-safe', {
      resources: [{ kind: 'gpio', name: 'sig', gpio: 5, direction: 'output' }],
    }),
  }, t);
  const { bodies, problems } = loadPlugins(dir);
  assert.deepEqual(bodies, {});
  assert.match(problems.join('\n'), /plugin unknown-op: command point: op "servo" is not one of the IO ops/);
  assert.match(problems.join('\n'), /plugin no-safe: output "sig" has no safe value/);
});

test('the manifest has to name itself, both labels, and its parts', (t) => {
  const dir = tempPlugins({
    unlabelled: manifest('unlabelled', { label: { en: 'Only English' } }),
    partless: manifest('partless', { parts: [] }),
    'bad-id': manifest('Bad Id'),
    'no-commands': manifest('no-commands', { commands: 'point' }),
  }, t);
  const { bodies, problems } = loadPlugins(dir);
  assert.deepEqual(bodies, {});
  const lines = problems.join('\n');
  assert.match(lines, /plugin unlabelled: label needs an en and a zh name/);
  assert.match(lines, /plugin partless: parts must be a list of part names/);
  assert.match(lines, /plugin bad-id: "Bad Id" is not a plugin id/);
  assert.match(lines, /plugin no-commands: commands must be an array/);
});

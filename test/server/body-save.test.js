// Saving a body from the bench: a manifest a person edited, written under a new
// id, and refused when it would be a body the model cannot use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveBody } from '../../server/plugin-bodies.js';
import { pluginBodies, registerPlugins } from '../../core/bodies.js';

const manifest = (extra = {}) => ({
  id: 'bench-led', label: { en: 'Bench LED', zh: '台面 LED' }, parts: ['esp32', 'led-5mm'],
  resources: [{ kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 }],
  commands: [{ name: 'on', args: { type: 'object', properties: {} }, timeoutMs: 500,
    run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }] }],
  examples: [{ name: 'light_up', say: 'Turn it on.', run: [{ command: 'on' }] }],
  wiring: { links: [{ a: 'esp:GPIO5', b: 'led:A' }] },
  ...extra,
});

test('a bench body is written and registered under its id', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'save-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); registerPlugins({}); });
  const out = /** @type {any} */ (saveBody(manifest(), { bodiesDir: dir }));
  assert.equal(out.id, 'bench-led');
  const written = JSON.parse(readFileSync(join(dir, 'bench-led', 'body.json'), 'utf8'));
  assert.equal(written.wiring.links.length, 1);
  assert.equal(written.examples.length, 1);
  assert.ok(pluginBodies()['bench-led']);
});

test('a body with no example action is refused: the model would have no tool', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'save-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = saveBody(manifest({ examples: [] }), { bodiesDir: dir });
  assert.match(/** @type {any} */ (out).error ?? '', /at least one example/);
});

test('a template name is not a body a person can save over', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'save-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = saveBody(manifest({ id: 'toy' }), { bodiesDir: dir });
  assert.match(/** @type {any} */ (out).error ?? '', /template|built-in/);
});

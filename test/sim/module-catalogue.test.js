// The module catalogue as the workbench reads it: one fetch at boot, a failed
// read that says so rather than an empty list, and a bad row that is dropped
// instead of taking the bench with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModuleCatalogue } from '../../sim/catalogue.js';

const reply = (/** @type {unknown} */ body, ok = true) => async () => ({ ok, json: async () => body });
const ledJson = () => JSON.parse(readFileSync(
  new URL('../../modules/led-module/module.json', import.meta.url), 'utf8'));

test('a catalogue is read from the brain', async () => {
  const { modules, failed } = await loadModuleCatalogue(reply([ledJson()]));
  assert.equal(failed, false);
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, 'led-module');
});

test('an unreachable brain is a failed read, not an empty catalogue', async () => {
  const { modules, failed } = await loadModuleCatalogue(async () => { throw new Error('down'); });
  assert.deepEqual(modules, []);
  assert.equal(failed, true);
});

test('a refused answer is a failed read too', async () => {
  const { failed } = await loadModuleCatalogue(reply({ error: 'nope' }, false));
  assert.equal(failed, true);
});

test('a malformed row is dropped, not fatal', async () => {
  const { modules } = await loadModuleCatalogue(reply([
    ledJson(),
    { nope: true },
    { id: 'no-wiring', label: { en: 'No wiring', zh: '无接线' } },
  ]));
  assert.deepEqual(modules.map((m) => m.id), ['led-module']);
});

test('a body the person saved is a project too', async () => {
  const saved = { id: 'bench-led', label: { en: 'Bench LED', zh: '台面 LED' },
    parts: ['esp32', 'led-5mm'], wiring: { links: [{ a: 'esp:GPIO5', b: 'led:A' }] } };
  const byPath = async (/** @type {string} */ path) => ({
    ok: true, json: async () => (path === '/api/bodies' ? [saved] : [ledJson()]),
  });
  const { modules, failed } = await loadModuleCatalogue(byPath);
  assert.equal(failed, false);
  assert.deepEqual(modules.map((m) => m.id), ['led-module', 'bench-led']);
});

test('one unreachable half is still a catalogue', async () => {
  const byPath = async (/** @type {string} */ path) => {
    if (path === '/api/bodies') throw new Error('down');
    return { ok: true, json: async () => [ledJson()] };
  };
  const { modules, failed } = await loadModuleCatalogue(byPath);
  assert.deepEqual(modules.map((m) => m.id), ['led-module']);
  assert.equal(failed, false);
});

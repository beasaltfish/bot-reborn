import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, TESTED_NODE } from '../../server/setup.js';

test('a missing model file points at the fetch script on unix', async () => {
  const checks = await runChecks({ nodeVersion: TESTED_NODE, models: false, portFree: async () => true, platform: 'darwin' });
  const models = checks.find((c) => c.id === 'models');
  assert.equal(models?.ok, false);
  assert.match(models?.fix ?? '', /server\/models\/fetch\.sh/);
});

test('on windows the same failure prints the two urls instead', async () => {
  const checks = await runChecks({ nodeVersion: TESTED_NODE, models: false, portFree: async () => true, platform: 'win32' });
  const models = checks.find((c) => c.id === 'models');
  assert.match(models?.fix ?? '', /https:\/\/github\.com\/k2-fsa\/sherpa-onnx/);
  assert.doesNotMatch(models?.fix ?? '', /fetch\.sh/);
});

test('an old node fails with the tested version named', async () => {
  const checks = await runChecks({ nodeVersion: '18.19.0', models: true, portFree: async () => true, platform: 'darwin' });
  const node = checks.find((c) => c.id === 'node');
  assert.equal(node?.ok, false);
  assert.match(node?.fix ?? '', new RegExp(TESTED_NODE));
});

test('a busy port is reported, not fatal for the checks themselves', async () => {
  const checks = await runChecks({ nodeVersion: TESTED_NODE, models: true, portFree: async () => false, platform: 'darwin' });
  assert.equal(checks.find((c) => c.id === 'port')?.ok, false);
  assert.equal(checks.find((c) => c.id === 'node')?.ok, true);
});

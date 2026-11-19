import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChecks, TESTED_NODE, modelsIntact, modelsProblem, ensureModels } from '../../server/setup.js';

test('a missing model file points at the fetch script on unix', async () => {
  const checks = await runChecks({ nodeVersion: TESTED_NODE, models: false, portFree: async () => true, needsBuild: false, platform: 'darwin' });
  const models = checks.find((c) => c.id === 'models');
  assert.equal(models?.ok, false);
  assert.match(models?.fix ?? '', /server\/models\/fetch\.sh/);
});

test('on windows the same failure prints the two urls instead', async () => {
  const checks = await runChecks({ nodeVersion: TESTED_NODE, models: false, portFree: async () => true, needsBuild: false, platform: 'win32' });
  const models = checks.find((c) => c.id === 'models');
  assert.match(models?.fix ?? '', /https:\/\/github\.com\/k2-fsa\/sherpa-onnx/);
  assert.doesNotMatch(models?.fix ?? '', /fetch\.sh/);
});

test('an old node fails with the tested version named', async () => {
  const checks = await runChecks({ nodeVersion: '18.19.0', models: true, portFree: async () => true, needsBuild: false, platform: 'darwin' });
  const node = checks.find((c) => c.id === 'node');
  assert.equal(node?.ok, false);
  assert.match(node?.fix ?? '', new RegExp(TESTED_NODE));
});

test('a busy port is reported, not fatal for the checks themselves', async () => {
  const checks = await runChecks({ nodeVersion: TESTED_NODE, models: true, portFree: async () => false, needsBuild: false, platform: 'darwin' });
  assert.equal(checks.find((c) => c.id === 'port')?.ok, false);
  assert.equal(checks.find((c) => c.id === 'node')?.ok, true);
});

test('the Node floor is the one the build tool actually needs', async () => {
  /** @param {string} v */
  const ok = async (v) => (await runChecks({ nodeVersion: v, models: true, portFree: async () => true, needsBuild: false })).find((c) => c.id === 'node')?.ok;
  assert.equal(await ok('20.0.0'), false);
  assert.equal(await ok('20.19.0'), true);
  assert.equal(await ok('22.11.0'), false);
  assert.equal(await ok('22.12.0'), true);
});

test('a truncated model download is not reported as ready', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'br-models-'));
  try {
    for (const name of ['encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx', 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx', 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx', 'tokens.txt', 'silero_vad.onnx']) {
      await writeFile(join(dir, name), 'not a model');
    }
    assert.equal(modelsIntact(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed fetch is a failure, not a success', async () => {
  assert.equal(await ensureModels({ present: () => false, run: () => 1 }), false);
  let ran = false;
  let present = false;
  assert.equal(await ensureModels({ present: () => present, run: () => { ran = true; present = true; return 0; } }), true);
  assert.equal(ran, true);
  assert.equal(await ensureModels({ present: () => true, run: () => 1 }), true);
});

test('a present but corrupted model is reported as such, not as missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'br-models-'));
  try {
    assert.equal(modelsProblem(dir), 'missing');
    for (const name of ['encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx', 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx', 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx', 'tokens.txt', 'silero_vad.onnx']) {
      await writeFile(join(dir, name), 'not a model');
    }
    assert.equal(modelsProblem(dir), 'corrupt');
    const checks = await runChecks({ nodeVersion: TESTED_NODE, models: modelsProblem(dir) === null, modelsProblem: modelsProblem(dir), portFree: async () => true, needsBuild: false, platform: 'darwin' });
    assert.match(checks.find((c) => c.id === 'models')?.detail ?? '', /corrupt/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

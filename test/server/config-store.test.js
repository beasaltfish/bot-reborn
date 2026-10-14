import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStorage } from '../../server/config-store.js';
import { loadConfig, saveConfig } from '../../web/config.js';

test('a missing file loads the defaults', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'nested', 'config.json');
  assert.equal(loadConfig(fileStorage(path)).bargeIn, true);
});

test('saved config round-trips and the file is readable JSON', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'nested', 'config.json');
  const store = fileStorage(path);
  const cfg = loadConfig(store);
  cfg.llm.model = 'qwen';
  saveConfig(cfg, store);
  assert.equal(loadConfig(store).llm.model, 'qwen');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).llm.model, 'qwen');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCharacter, listCharacters, findByToken, saveCharacter, ready,
} from '../../server/characters.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'chars-')), 'characters');

test('a new character gets a 32-hex token, defaults, and a private file', () => {
  const dir = tmp();
  const c = createCharacter('小黑', dir);
  assert.match(c.token, /^[0-9a-f]{32}$/);
  assert.equal(c.name, '小黑');
  assert.equal(c.config.bargeIn, true);
  assert.equal(statSync(c.path).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.deepEqual(listCharacters(dir).characters.map((x) => x.name), ['小黑']);
});

test('two characters never share a token', () => {
  const dir = tmp();
  assert.notEqual(createCharacter('a', dir).token, createCharacter('b', dir).token);
});

test('an existing name is refused, and so is anything path-like', () => {
  const dir = tmp();
  createCharacter('a', dir);
  assert.throws(() => createCharacter('a', dir), /already exists/);
  for (const bad of ['', ' ', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(41)]) {
    assert.throws(() => createCharacter(bad, dir), /name/, JSON.stringify(bad));
  }
});

test('findByToken matches exactly and never throws on odd input', () => {
  const dir = tmp();
  const a = createCharacter('a', dir);
  const b = createCharacter('b', dir);
  const all = listCharacters(dir).characters;
  assert.equal(findByToken(all, a.token)?.name, 'a');
  assert.equal(findByToken(all, b.token)?.name, 'b');
  for (const bad of ['', 'zz'.repeat(16), a.token + '00', a.token.slice(1), 42, null]) {
    assert.equal(findByToken(all, bad), null, JSON.stringify(bad));
  }
});

test('saving keeps the token and name, and the edit survives a reload', () => {
  const dir = tmp();
  const c = createCharacter('a', dir);
  c.config.tts.voice = 'nova';
  saveCharacter(c);
  const [again] = listCharacters(dir).characters;
  assert.equal(again.token, c.token);
  assert.equal(again.config.tts.voice, 'nova');
  assert.equal(statSync(c.path).mode & 0o777, 0o600);
});

test('a broken file is reported and the others still load', () => {
  const dir = tmp();
  createCharacter('good', dir);
  writeFileSync(join(dir, 'bad.json'), '{ not json');
  writeFileSync(join(dir, 'notoken.json'), JSON.stringify({ name: 'x', config: {} }));
  const { characters, problems } = listCharacters(dir);
  assert.deepEqual(characters.map((c) => c.name), ['good']);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /bad\.json/);
});

test('a missing directory is no characters, not a crash', () => {
  assert.deepEqual(listCharacters(join(tmp(), 'nope')), { characters: [], problems: [] });
});

test('ready means stt, llm and tts are all filled in', () => {
  const c = createCharacter('a', tmp());
  assert.equal(ready(c.config), false);
  c.config.stt = { baseURL: 'u', apiKey: 'k', model: 'm', prompt: '' };
  c.config.llm = { baseURL: 'u', apiKey: 'k', model: 'm' };
  c.config.tts = { baseURL: 'u', apiKey: 'k', model: 'm', voice: 'v' };
  assert.equal(ready(c.config), true);
});

test('the file on disk is { name, token, config }', () => {
  const c = createCharacter('a', tmp());
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(c.path, 'utf8'))), ['name', 'token', 'config']);
});

test('a robot saving its reply language keeps what was edited by hand meanwhile', async () => {
  // Found in review: the robot wrote back the whole file as it was at hello,
  // so a token changed while it was online came back, silently.
  const { updateConfig } = await import('../../server/characters.js');
  const dir = tmp();
  const c = createCharacter('a', dir);
  const onDisk = JSON.parse(readFileSync(c.path, 'utf8'));
  onDisk.token = 'cd'.repeat(16);
  onDisk.config.llm.apiKey = 'edited';
  writeFileSync(c.path, JSON.stringify(onDisk));
  updateConfig(c.path, (cfg) => { cfg.replyLang = 'zh'; });
  const after = JSON.parse(readFileSync(c.path, 'utf8'));
  assert.equal(after.token, 'cd'.repeat(16));
  assert.equal(after.config.llm.apiKey, 'edited');
  assert.equal(after.config.replyLang, 'zh');
  assert.equal(statSync(c.path).mode & 0o777, 0o600);
});

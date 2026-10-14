import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { connectFakeBody } from '../../server/fake-body.js';
import { tempCharacters, fakeFetch, until } from './helpers.js';

const W = { 'X-Bot-Reborn': '1', 'Content-Type': 'application/json' };

function dist() {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(d, 'index.html'), '<!doctype html><title>admin</title>');
  mkdirSync(join(d, 'assets'));
  writeFileSync(join(d, 'assets', 'app.js'), 'console.log(1)');
  return d;
}

async function rig() {
  const chars = tempCharacters();
  const server = createBrainServer({
    dir: chars.dir, adminDist: dist(), fetch: fakeFetch(), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => ({ kws: { accept: () => [] }, vad: { accept() {}, detected: false, drain: () => [], clear() {} } }),
    log: () => {},
  });
  const port = await server.listen(0);
  const base = `http://127.0.0.1:${port}`;
  /** @param {string} path @param {RequestInit} [init] */
  const call = async (path, init) => {
    const r = await fetch(base + path, init);
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, type: r.headers.get('content-type') };
  };
  return { chars, server, port, call };
}

test('the list has names, readiness and presence — never keys or tokens', async () => {
  const r = await rig();
  r.chars.add('a');
  const { status, body } = await r.call('/api/characters');
  assert.equal(status, 200);
  assert.deepEqual(body, [{ id: 'a', name: 'a', ready: true, online: false }]);
  await r.server.close();
});

test('create, read, patch by deep merge, rename without moving, delete', async () => {
  const r = await rig();
  const made = await r.call('/api/characters', { method: 'POST', headers: W, body: JSON.stringify({ name: 'rex' }) });
  assert.equal(made.status, 201);
  assert.match(made.body.token, /^[0-9a-f]{32}$/);
  const patched = await r.call('/api/characters/rex', {
    method: 'PATCH', headers: W, body: JSON.stringify({ name: '小黑', config: { tts: { voice: 'nova' } } }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.id, 'rex');
  assert.equal(patched.body.name, '小黑');
  assert.equal(patched.body.config.tts.voice, 'nova');
  assert.equal(patched.body.config.tts.model, made.body.config.tts.model);   // a sibling, untouched
  const read = await r.call('/api/characters/rex');
  assert.equal(read.body.token, made.body.token);
  const gone = await r.call('/api/characters/rex', { method: 'DELETE', headers: W });
  assert.equal(gone.status, 200);
  assert.equal((await r.call('/api/characters/rex')).status, 404);
  await r.server.close();
});

test('bad input is a 400 with a reason, an unknown id a 404', async () => {
  const r = await rig();
  r.chars.add('a');
  const dup = await r.call('/api/characters', { method: 'POST', headers: W, body: JSON.stringify({ name: 'a' }) });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /already exists/);
  const bad = await r.call('/api/characters', { method: 'POST', headers: W, body: JSON.stringify({ name: '../x' }) });
  assert.equal(bad.status, 400);
  const junk = await r.call('/api/characters', { method: 'POST', headers: W, body: '{not json' });
  assert.equal(junk.status, 400);
  assert.equal((await r.call('/api/characters/nobody')).status, 404);
  await r.server.close();
});

test('a write without the custom header is refused, so another page cannot make one', async () => {
  const r = await rig();
  const res = await r.call('/api/characters', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(res.status, 403);
  assert.deepEqual((await r.call('/api/characters')).body, []);
  await r.server.close();
});

test('a request naming another host is refused, page and API alike', async () => {
  const r = await rig();
  for (const path of ['/', '/api/characters']) {
    const status = await new Promise((resolve) => {
      request({ host: '127.0.0.1', port: r.port, path, headers: { Host: 'evil.example' } },
        (res) => { res.resume(); resolve(res.statusCode); }).end();
    });
    assert.equal(status, 403, path);
  }
  await r.server.close();
});

test('re-keying an online character drops its body, and the old token no longer works', async () => {
  const r = await rig();
  const a = r.chars.add('a');
  const url = `ws://127.0.0.1:${r.port}/body`;
  const body = await connectFakeBody(url, { token: a.token });
  await until(() => body.messages.some((m) => m.type === 'state'));
  assert.equal((await r.call('/api/characters')).body[0].online, true);
  const res = await r.call('/api/characters/a/token', { method: 'POST', headers: W });
  assert.notEqual(res.body.token, a.token);
  await until(() => body.halted !== null);
  await assert.rejects(connectFakeBody(url, { token: a.token }), /reject.*token|"reason":"token"/);
  await r.server.close();
});

test('deleting an online character drops its body', async () => {
  const r = await rig();
  const a = r.chars.add('a');
  const body = await connectFakeBody(`ws://127.0.0.1:${r.port}/body`, { token: a.token });
  await until(() => body.messages.some((m) => m.type === 'state'));
  await r.call('/api/characters/a', { method: 'DELETE', headers: W });
  await until(() => body.halted !== null);
  await r.server.close();
});

test('the page, its assets and the check clips are served; nothing outside them is', async () => {
  const r = await rig();
  const page = await r.call('/');
  assert.equal(page.status, 200);
  assert.match(String(page.type), /text\/html/);
  assert.match(String((await r.call('/assets/app.js')).type), /javascript/);
  const clip = await r.call('/fixtures/check-en.wav');
  assert.equal(clip.status, 200);
  assert.match(String(clip.type), /audio\/wav/);
  assert.equal((await r.call('/fixtures/../../package.json')).status, 404);
  assert.equal((await r.call('/%2e%2e/package.json')).status, 404);
  assert.equal((await r.call('/fixtures/mine.wav')).status, 404);
  await r.server.close();
});

test('an empty characters directory still serves an empty list', async () => {
  const r = await rig();
  assert.deepEqual((await r.call('/api/characters')).body, []);
  await r.server.close();
});

test('an unbuilt page says how to build it', async () => {
  const chars = tempCharacters();
  const server = createBrainServer({
    dir: chars.dir, adminDist: join(tmpdir(), 'no-such-dist'), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => { throw new Error('no body'); }, log: () => {},
  });
  const port = await server.listen(0);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /npm run admin:build/);
  await server.close();
});

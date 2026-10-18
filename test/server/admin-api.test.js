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

test('the page learns where a phone can reach this brain', async () => {
  const chars = tempCharacters();
  const server = createBrainServer({
    dir: chars.dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
    addresses: () => ['192.168.1.5', '10.0.0.7'],
  });
  const port = await server.listen(0);
  const r = await fetch(`http://127.0.0.1:${port}/api/lan`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { port, addresses: ['192.168.1.5', '10.0.0.7'] });
  await server.close();
});

test('the phone addresses are the Wi-Fi ones: private, not tunnels, not bridges', async () => {
  const { lanAddressesFrom } = await import('../../server/admin-api.js');
  /** @param {string} address @param {boolean} [internal] */
  const v4 = (address, internal = false) => ({ family: 'IPv4', internal, address });
  const ifaces = {
    lo0: [v4('127.0.0.1', true)],
    en0: [v4('192.168.3.79')],
    bridge100: [v4('192.168.139.3')],
    bridge101: [v4('192.168.97.0')],
    utun7: [v4('198.18.0.1')],
    tailscale0: [v4('100.101.2.3')],
    en5: [v4('10.0.0.7'), { family: 'IPv6', internal: false, address: 'fe80::1' }],
    eth1: [v4('172.20.1.1'), v4('8.8.8.8')],
  };
  assert.deepEqual(lanAddressesFrom(ifaces), ['192.168.3.79', '10.0.0.7', '172.20.1.1']);
});

test('endpoints are kept per character, and checked before they are written', async () => {
  const r = await rig();
  await r.call('/api/characters', { method: 'POST', headers: W, body: JSON.stringify({ name: 'rex' }) });
  const groq = { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-1' };
  const first = await r.call('/api/characters/rex', {
    method: 'PATCH', headers: W, body: JSON.stringify({ endpoints: [groq] }),
  });
  assert.equal(first.status, 200);
  const mine = { id: 'ep-1', name: 'Home', baseURL: 'http://10.0.0.5:11434/v1', apiKey: 'k', custom: true };
  const second = await r.call('/api/characters/rex', {
    method: 'PATCH', headers: W, body: JSON.stringify({ endpoints: [groq, mine] }),
  });
  assert.deepEqual(second.body.endpoints, [groq, mine]);
  assert.equal(second.body.config.llm.apiKey, '', 'the layers are not touched by the list');
  const bad = await r.call('/api/characters/rex', { method: 'PATCH', headers: W, body: JSON.stringify({ endpoints: [{ id: 'a', name: 'a', baseURL: 'x', apiKey: 3 }] }) });
  assert.equal(bad.status, 400);
  const many = Array.from({ length: 51 }, (_, i) => ({ id: `ep-${i}`, name: 'n', baseURL: 'http://x', apiKey: '', custom: true }));
  const tooMany = await r.call('/api/characters/rex', { method: 'PATCH', headers: W, body: JSON.stringify({ endpoints: many }) });
  assert.equal(tooMany.status, 400);
  await r.server.close();
});

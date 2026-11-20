import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, createServer } from 'node:http';
import WebSocket from 'ws';
import { createBrainServer } from '../../server/brain-server.js';
import { createAdminApi, setupIdFor } from '../../server/admin-api.js';
import { createDistPages, FIXTURES_DIR } from '../../server/dist-pages.js';
import { renderEarcons } from '../../server/audio/render.js';
import { connectFakeBody } from '../../server/fake-body.js';
import { PROTOCOL } from '../../core/protocol.js';
import { tempCharacters, fakeFetch, until } from './helpers.js';

const W = { 'X-Bot-Reborn': '1', 'Content-Type': 'application/json' };

function dist() {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(d, 'admin'));
  writeFileSync(join(d, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  mkdirSync(join(d, 'assets'));
  writeFileSync(join(d, 'assets', 'app.js'), 'console.log(1)');
  return d;
}

async function rig(chars = tempCharacters()) {
  const server = createBrainServer({
    dir: chars.dir, pages: () => createDistPages({ dist: dist(), fixtures: FIXTURES_DIR }), fetch: fakeFetch(), sfx: new Map(), earcons: renderEarcons(),
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
  const a = r.chars.add('a');
  const { status, body } = await r.call('/api/characters');
  assert.equal(status, 200);
  assert.deepEqual(body, [{
    id: 'a', name: 'a', ready: true, online: false,
    motion: 'toy', verbs: ['drive', 'halt', 'voice'], setupId: setupIdFor(a.token),
  }]);
  await r.server.close();
});

test('the setup id is a stable, non-secret fingerprint; the list leaks no credentials', async () => {
  const r = await rig();
  const a = r.chars.add('a', (cfg) => { cfg.llm.apiKey = 'secret-llm-key'; });
  const list = (await r.call('/api/characters')).body;
  const detail = (await r.call('/api/characters/a')).body;

  assert.match(list[0].setupId, /^[0-9a-f]{64}$/);
  assert.equal(list[0].setupId, setupIdFor(a.token));
  assert.equal(list[0].setupId, detail.setupId);
  assert.notEqual(list[0].setupId, a.token);
  assert.equal(list[0].setupId.includes(a.token), false);

  // The list is what the page polls: it must never carry the token or a key.
  assert.equal('token' in list[0], false);
  assert.equal('endpoints' in list[0], false);
  assert.equal(JSON.stringify(list).includes(a.token), false);
  assert.equal(JSON.stringify(list).includes(a.config.llm.apiKey), false);
  await r.server.close();
});

test('the summary carries when a body was first seen and first spoke, and only for that body', async () => {
  const chars = tempCharacters();
  chars.add('a');
  chars.add('b');
  const presence = {
    /** @param {string} id */
    of: (id) => (id === 'a' ? { lastSeenAt: 111, lastSpokeAt: 222 } : {}),
  };
  const server = createServer(createAdminApi({
    dir: chars.dir, link: { online: () => [], kick: () => false }, presence,
  }));
  await new Promise((resolve) => server.listen(0, () => resolve(undefined)));
  try {
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const body = await (await fetch(`http://127.0.0.1:${port}/api/characters`)).json();
    const a = body.find((/** @type {any} */ c) => c.id === 'a');
    const b = body.find((/** @type {any} */ c) => c.id === 'b');
    assert.equal(a.lastSeenAt, 111);
    assert.equal(a.lastSpokeAt, 222);
    assert.equal('lastSeenAt' in b, false);
    assert.equal('lastSpokeAt' in b, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a body that connects is seen, a spoken reply is heard, and the wake beep is neither', async () => {
  const chars = tempCharacters();
  const me = chars.add('me');
  /** @type {Float32Array[]} */
  let segments = [];
  const server = createBrainServer({
    dir: chars.dir, pages: () => createDistPages({ dist: dist(), fixtures: FIXTURES_DIR }), fetch: fakeFetch(), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => ({
      kws: { accept: () => [] },
      vad: {
        accept() {}, detected: false,
        drain() { const q = segments; segments = []; return q; },
        clear() { segments = []; },
      },
    }),
    log: () => {},
  });
  const port = await server.listen(0);
  const body = await connectFakeBody(`ws://127.0.0.1:${port}/body`, { token: me.token });
  /** @returns {Promise<any[]>} */
  const list = async () => (await (await fetch(`http://127.0.0.1:${port}/api/characters`)).json());
  try {
    await body.waitFor((m) => m.type === 'state' && m.state === 'LISTENING');
    const seen = await list();
    assert.equal(typeof seen[0].lastSeenAt, 'number');
    assert.equal(seen[0].lastSpokeAt, undefined, 'the wake earcon is not speech');

    segments = [new Float32Array(16000).map((_, i) => 0.3 * Math.sin(i / 5))];
    // The wake earcon shuts the ears for its own length; keep feeding frames
    // the way a body does until the queued segment is taken.
    const deadline = Date.now() + 3000;
    while (!body.messages.some((m) => m.type === 'state' && m.state === 'THINKING')) {
      if (Date.now() > deadline) throw new Error(`no THINKING; got ${JSON.stringify(body.messages)}`);
      await body.sendPcm(new Int16Array(1600), { paceMs: 0 });
      await new Promise((r) => setTimeout(r, 20));
    }
    await body.waitFor((m) => m.type === 'state' && m.state === 'LISTENING'
      && body.messages.some((x) => x.state === 'SPEAKING'), 10000);
    const heard = await list();
    assert.equal(typeof heard[0].lastSpokeAt, 'number');
  } finally {
    body.close();
    await server.close();
  }
});

test('a new brain has not met anyone, even a body the last one met', async () => {
  const chars = tempCharacters();
  const a = chars.add('a');
  const first = await rig(chars);
  const body = await connectFakeBody(`ws://127.0.0.1:${first.port}/body`, { token: a.token });
  try {
    await body.waitFor((m) => m.type === 'state');
    assert.equal(typeof (await first.call('/api/characters')).body[0].lastSeenAt, 'number');
  } finally {
    body.close();
    await first.server.close();
  }

  const second = await rig(chars);
  try {
    assert.equal((await second.call('/api/characters')).body[0].lastSeenAt, undefined);
  } finally {
    await second.server.close();
  }
});

test('deleting and recreating a name keeps its id but not its setup identity or presence', async () => {
  const r = await rig();
  const first = r.chars.add('again');
  const body = await connectFakeBody(`ws://127.0.0.1:${r.port}/body`, { token: first.token });
  try {
    await until(() => body.messages.some((m) => m.type === 'state'));
    const before = (await r.call('/api/characters')).body[0];
    assert.equal(before.id, 'again');
    assert.equal(typeof before.lastSeenAt, 'number');

    await r.call('/api/characters/again', { method: 'DELETE', headers: W });
    await until(() => body.halted !== null);
    const made = await r.call('/api/characters', { method: 'POST', headers: W, body: JSON.stringify({ name: 'again' }) });
    assert.equal(made.body.id, 'again');
    assert.notEqual(made.body.token, first.token);

    const after = (await r.call('/api/characters')).body[0];
    assert.equal(after.id, 'again');
    assert.notEqual(after.setupId, before.setupId);
    assert.equal(after.lastSeenAt, undefined, 'the old generation’s presence must not follow the name');
    assert.equal(after.lastSpokeAt, undefined);
  } finally {
    body.close();
    await r.server.close();
  }
});

/** @param {string} url @param {Record<string, unknown>} hello */
async function sayHello(url, hello) {
  const ws = new WebSocket(url);
  /** @type {any[]} */ const msgs = [];
  ws.on('message', (d, bin) => {
    if (bin) return;
    const m = JSON.parse(String(d));
    if (m.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    msgs.push(m);
  });
  await new Promise((res) => ws.once('open', res));
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, ...hello }));
  await until(() => msgs.length > 0);
  return { ws, msgs };
}

test('a connected phone says so without changing how the character moves, and the marker clears on reconnect', async () => {
  const r = await rig();
  const car = r.chars.add('car', (cfg) => { cfg.body.id = 'toy'; });
  const phone = await sayHello(`ws://127.0.0.1:${r.port}/body`, { token: car.token, body: 'phone' });
  try {
    assert.equal(phone.msgs[0].type, 'welcome');
    const withPhone = (await r.call('/api/characters')).body[0];
    assert.equal(withPhone.motion, 'toy');
    assert.equal(withPhone.bodyKind, 'phone');

    phone.ws.close();
    await until(() => phone.ws.readyState === WebSocket.CLOSED);
    await new Promise((res) => setTimeout(res, 50));

    const board = await sayHello(`ws://127.0.0.1:${r.port}/body`, { token: car.token });
    assert.equal(board.msgs[0].type, 'welcome');
    const afterBoard = (await r.call('/api/characters')).body[0];
    assert.equal('bodyKind' in afterBoard, false, 'an unmarked body must not inherit the last marker');
    board.ws.close();
  } finally {
    phone.ws.close();
    await r.server.close();
  }
});

test('the phone marker is ignored when admission fails', async () => {
  const r = await rig();
  const car = r.chars.add('car');
  const bad = await sayHello(`ws://127.0.0.1:${r.port}/body`, { token: '0'.repeat(32), body: 'phone' });
  try {
    assert.deepEqual(bad.msgs[0], { type: 'reject', reason: 'token' });
    const list = (await r.call('/api/characters')).body;
    assert.equal(list[0].id, car.id);
    assert.equal('bodyKind' in list[0], false);
  } finally {
    bad.ws.close();
    await r.server.close();
  }
});

test('the list says how each character moves, so the bench can tell a pet', async () => {
  const r = await rig();
  r.chars.add('petty', (cfg) => { cfg.body.id = 'pet'; });
  const { body } = await r.call('/api/characters');
  assert.equal(body[0].motion, 'pet');
  await r.server.close();
});

test('the list carries verbs for the simulator, not action names', async () => {
  const r = await rig();
  r.chars.add('petty', (cfg) => { cfg.body.id = 'pet'; });
  const { body } = await r.call('/api/characters');
  const pet = body[0];

  // What the bench asks is "can it pose?", so the list names the verb `pose`,
  // never the action that runs it.
  assert.ok(pet.verbs.includes('pose'));
  assert.ok(pet.verbs.includes('voice'), 'a bark is the voice verb');
  assert.equal(pet.verbs.includes('draw_card'), false);
  assert.equal(pet.verbs.includes('move'), false, 'no action name reaches the list');
  // The id stays beside it: an old tab still reads `motion`.
  assert.equal(pet.motion, 'pet');

  // A body's own actions answer for it, not its template.
  r.chars.add('cards', (cfg) => { cfg.body.id = 'toy'; });
  const toy = (await r.call('/api/characters')).body.find((/** @type {any} */ c) => c.id === 'cards');
  assert.deepEqual(toy.verbs, ['drive', 'halt', 'voice']);
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
    dir: chars.dir, pages: () => createDistPages({ dist: join(tmpdir(), 'no-such-dist'), fixtures: FIXTURES_DIR }), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => { throw new Error('no body'); }, log: () => {},
  });
  const port = await server.listen(0);
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /npm run build/);
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

test('saved reflexes come back with the character, and are checked before they are written', async () => {
  const { REFLEX_PRESETS } = await import('../../core/reflex-presets.js');
  const r = await rig();
  await r.call('/api/characters', { method: 'POST', headers: W, body: JSON.stringify({ name: 'rex' }) });
  const fresh = await r.call('/api/characters/rex');
  assert.deepEqual(fresh.body.savedReflexes, []);
  const saved = { name: 'Mine', threshold: 0.7, state: fresh.body.config.reflex.state, question: REFLEX_PRESETS[1].question };
  const ok = await r.call('/api/characters/rex', { method: 'PATCH', headers: W, body: JSON.stringify({ savedReflexes: [saved] }) });
  assert.deepEqual(ok.body.savedReflexes, [saved]);
  const bad = await r.call('/api/characters/rex', { method: 'PATCH', headers: W, body: JSON.stringify({ savedReflexes: [{ ...saved, question: null }] }) });
  assert.equal(bad.status, 400);
  await r.server.close();
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

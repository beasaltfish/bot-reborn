import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { servePhone, serveSim } from '../../server/static.js';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'phone-'));
  const phone = join(root, 'phone');
  const core = join(root, 'core');
  mkdirSync(join(core, 'fixtures'), { recursive: true });
  mkdirSync(phone);
  writeFileSync(join(phone, 'index.html'), '<p>body</p>');
  writeFileSync(join(phone, 'manifest.webmanifest'), '{}');
  writeFileSync(join(core, 'protocol.js'), 'export {};');
  writeFileSync(join(core, 'fixtures', 'me.wav'), 'RIFF');
  writeFileSync(join(root, 'secret.txt'), 'nope');
  return { phone, core };
}

/** @param {{ phone: string, core: string }} dirs */
async function serve(dirs) {
  const http = createServer((req, res) => {
    if (!servePhone(req, res, dirs)) { res.writeHead(418); res.end(); }
  });
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  const get = (/** @type {string} */ path) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  return { get, close: () => http.close() };
}

test('the phone page and the core modules are served', async () => {
  const s = await serve(tree());
  const page = await s.get('/phone/');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<p>body</p>');
  assert.equal((await s.get('/phone/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
  const mod = await s.get('/core/protocol.js');
  assert.equal(mod.status, 200);
  assert.match(String(mod.headers.get('content-type')), /javascript/);
  s.close();
});

test('/phone without its slash is sent to /phone/, so relative links resolve', async () => {
  const s = await serve(tree());
  const r = await s.get('/phone');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/phone/');
  s.close();
});

test('nothing outside the two roots, and nothing but .js from core/', async () => {
  const s = await serve(tree());
  // A recorded fixture is a person's voice.
  assert.equal((await s.get('/core/fixtures/me.wav')).status, 418);
  assert.equal((await s.get('/phone/..%2Fsecret.txt')).status, 404);
  assert.equal((await s.get('/phone/missing.js')).status, 404);
  assert.equal((await s.get('/api/characters')).status, 418);
  assert.equal((await s.get('/')).status, 418);
  s.close();
});

test('the simulator is served from sim/ and three/, and nothing outside them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sim-'));
  const sim = join(root, 'sim');
  const three = join(root, 'three');
  mkdirSync(sim);
  mkdirSync(three);
  writeFileSync(join(sim, 'index.html'), '<p>sim</p>');
  writeFileSync(join(three, 'three.js'), 'export {};');
  writeFileSync(join(root, 'secret.txt'), 'nope');
  const http = createServer((req, res) => {
    if (!serveSim(req, res, { sim, three })) { res.writeHead(418); res.end(); }
  });
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  const get = (/** @type {string} */ path) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  assert.equal((await get('/sim/')).status, 200);
  assert.equal((await get('/sim')).headers.get('location'), '/sim/');
  assert.equal((await get('/sim/vendor/three/three.js')).status, 200);
  // fetch folds a literal /sim/../ away before sending, so the escape that can
  // reach the server is the encoded one.
  assert.equal((await get('/sim/..%2Fserver/main.js')).status, 404);
  assert.equal((await get('/sim/vendor/three/..%2Fsecret.txt')).status, 404);
  assert.equal((await get('/phone/')).status, 418);
  http.close();
});

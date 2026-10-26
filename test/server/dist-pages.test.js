import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDistPages } from '../../server/dist-pages.js';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { tempCharacters } from './helpers.js';

/** A dist/ as the build leaves it, a file beside it, and a fixtures dir. */
function tree({ built = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'distp-'));
  const dist = join(root, 'dist');
  const fixtures = join(root, 'fixtures');
  for (const d of ['admin', 'sim', 'phone', 'assets']) mkdirSync(join(dist, d), { recursive: true });
  mkdirSync(fixtures);
  if (built) writeFileSync(join(dist, 'admin', 'index.html'), '<p>admin</p>');
  writeFileSync(join(dist, 'sim', 'index.html'), '<p>sim</p>');
  writeFileSync(join(dist, 'phone', 'index.html'), '<p>phone</p>');
  writeFileSync(join(dist, 'phone', 'manifest.webmanifest'), '{}');
  writeFileSync(join(dist, 'assets', 'app-1a2b3c.js'), 'export {};');
  writeFileSync(join(root, 'secret.txt'), 'nope');
  writeFileSync(join(fixtures, 'check-en.wav'), 'RIFF');
  writeFileSync(join(fixtures, 'me.wav'), 'RIFF');
  return { dist, fixtures };
}

/** @param {import('../../server/pages.js').PageServer} pages */
async function serve(pages) {
  const http = createServer(async (req, res) => {
    if (!(await pages.serve(req, res))) { res.writeHead(418); res.end(); }
  });
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  const get = (/** @type {string} */ path) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
  return { get, close: () => http.close() };
}

test('each page comes from dist/, never cached without asking', async () => {
  const s = await serve(createDistPages(tree()));
  for (const [path, body] of [['/', '<p>admin</p>'], ['/sim/', '<p>sim</p>'], ['/phone/', '<p>phone</p>']]) {
    const r = await s.get(path);
    assert.equal(r.status, 200, path);
    assert.equal(await r.text(), body);
    assert.equal(r.headers.get('cache-control'), 'no-cache', path);
  }
  s.close();
});

test('/phone and /sim without their slash are sent to it, so relative links resolve', async () => {
  const s = await serve(createDistPages(tree()));
  for (const p of ['/phone', '/sim']) {
    const r = await s.get(p);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), `${p}/`);
  }
  s.close();
});

test('hashed assets are cached for good; the manifest is not', async () => {
  const s = await serve(createDistPages(tree()));
  const js = await s.get('/assets/app-1a2b3c.js');
  assert.equal(js.status, 200);
  assert.match(String(js.headers.get('content-type')), /javascript/);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const m = await s.get('/phone/manifest.webmanifest');
  assert.equal(m.headers.get('content-type'), 'application/manifest+json');
  assert.equal(m.headers.get('cache-control'), 'no-cache');
  s.close();
});

test('only the synthesised check clips, and nothing outside dist/', async () => {
  const s = await serve(createDistPages(tree()));
  assert.equal((await s.get('/fixtures/check-en.wav')).status, 200);
  assert.equal((await s.get('/fixtures/me.wav')).status, 418);    // a person's voice
  for (const p of ['/phone/..%2F..%2Fsecret.txt', '/assets/..%2F..%2Fsecret.txt', '/%2e%2e/secret.txt']) {
    const r = await s.get(p);
    assert.notEqual(r.status, 200, p);
    assert.notEqual(await r.text(), 'nope', p);
  }
  assert.equal((await s.get('/nope.js')).status, 418);
  s.close();
});

test('an unbuilt dist/ says how to build it', async () => {
  const s = await serve(createDistPages(tree({ built: false })));
  for (const p of ['/', '/phone/']) {
    const r = await s.get(p);
    assert.equal(r.status, 503, p);
    assert.match(await r.text(), /npm run build/);
  }
  s.close();
});

test('the network gets the phone page and assets, nothing else', async () => {
  const t = tree();
  const server = createBrainServer({
    dir: tempCharacters().dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no body'); },
    pages: () => createDistPages(t),
  });
  const port = await server.listen(0);
  /** @param {string} path @param {string} host */
  const status = (path, host) => new Promise((resolve) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: host } },
      (res) => { res.resume(); resolve(res.statusCode); }).end();
  });
  const lan = `192.168.1.20:${port}`;
  for (const p of ['/phone/', '/assets/app-1a2b3c.js']) assert.equal(await status(p, lan), 200, p);
  for (const p of ['/', '/sim/', '/api/characters', '/fixtures/check-en.wav']) assert.equal(await status(p, lan), 403, p);
  assert.equal(await status('/', `localhost:${port}`), 200);
  await server.close();
});

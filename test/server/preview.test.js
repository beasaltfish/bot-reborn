import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewFile, previewList, servePreview } from '../../server/preview.js';

test('a preview file lives in one of the two material folders', () => {
  assert.equal(previewFile('/preview/pet/320x240/rest-sit/001.jpg')?.root, 'pet');
  assert.match(previewFile('/preview/pet/320x240/rest-sit/001.jpg')?.file ?? '', /pet[/\\]frames[/\\]320x240[/\\]rest-sit[/\\]001\.jpg$/);
  assert.equal(previewFile('/preview/tarot/320x240/back.jpg')?.root, 'tarot');
});

test('nothing outside those two folders, however it is spelled', () => {
  for (const p of [
    '/preview/pet/../characters/a.json',
    '/preview/pet/320x240/../../../core/config.js',
    '/preview/pet/..%2f..%2fcore%2fconfig.js',
    '/preview/pet/..\\..\\core\\config.js',
    '/preview/../key',
    '/preview/pet/',
    '/preview/pet',
    '/preview/nope/320x240/x.jpg',
    '/preview/pet/320x240/rest-sit/001.gif',
    '/preview/pet/320x240/rest-sit/001.jpg/../002.jpg',
    '/preview/pet/320x240/rest-sit/001.JPG',
    '/preview/pet//320x240/x.jpg',
  ]) assert.equal(previewFile(p), null, p);
});

test('the listing names only files that previewFile would serve', () => {
  const list = previewList();
  assert.ok(list.pet.length > 0, 'pet frames');
  assert.ok(list.tarot.length > 0, 'tarot cards');
  for (const root of /** @type {const} */ (['pet', 'tarot'])) {
    for (const rel of list[root]) {
      assert.match(rel, /^[a-z0-9][a-z0-9._/-]*\.jpg$/, rel);
      assert.ok(!rel.split('/').includes('..'), rel);
      assert.ok(previewFile(`/preview/${root}/${rel}`), rel);
    }
  }
});

/** A response that records what was written. */
function recorder() {
  const out = { status: 0, headers: /** @type {any} */ ({}), body: /** @type {any} */ (null) };
  return {
    out,
    res: {
      /** @param {number} status @param {any} headers */
      writeHead(status, headers) { out.status = status; out.headers = headers; },
      /** @param {any} body */ end(body) { out.body = body; },
    },
  };
}

test('the preview shows the largest art there is, and a card face, not just the back', () => {
  const list = previewList();
  // The render tools write every size; the smallest is a 160 px panel, not a preview.
  for (const root of /** @type {const} */ (['pet', 'tarot'])) {
    for (const rel of list[root]) assert.match(rel, /^320x240\//, `${root}: ${rel}`);
  }
  // A face carries its language in the name — `cups-01.en.jpg` — so a grammar
  // that stops at the first dot would only ever show backs and shuffles.
  assert.ok(list.tarot.some((rel) => /\.(en|zh)\.jpg$/.test(rel)), list.tarot.join(' '));
});

test('a real frame is served by extension, a made-up one is a 404', async () => {
  const first = recorder();
  assert.equal(await servePreview(/** @type {any} */ ({ url: '/preview/pet/320x240/rest-sit/001.jpg', method: 'GET' }), /** @type {any} */ (first.res)), true);
  assert.equal(first.out.status, 200);
  assert.equal(first.out.headers['Content-Type'], 'image/jpeg');
  assert.ok(first.out.body.length > 1000, 'a frame, not a stub');

  const missing = recorder();
  assert.equal(await servePreview(/** @type {any} */ ({ url: '/preview/pet/320x240/rest-sit/999.jpg', method: 'GET' }), /** @type {any} */ (missing.res)), true);
  assert.equal(missing.out.status, 404);
  assert.equal(missing.out.headers['Content-Type'], 'text/plain; charset=utf-8');
});

test('the listing is JSON the admin page can read', async () => {
  const r = recorder();
  assert.equal(await servePreview(/** @type {any} */ ({ url: '/preview/list.json', method: 'GET' }), /** @type {any} */ (r.res)), true);
  assert.equal(r.out.status, 200);
  assert.equal(r.out.headers['Content-Type'], 'application/json; charset=utf-8');
  const parsed = JSON.parse(String(r.out.body));
  assert.ok(Array.isArray(parsed.pet) && parsed.pet.length > 0);
  assert.ok(Array.isArray(parsed.tarot) && parsed.tarot.length > 0);
});

test('the brain serves a preview here and refuses it from the network', { timeout: 20000 }, async () => {
  const { request } = await import('node:http');
  const { createBrainServer } = await import('../../server/brain-server.js');
  const { renderEarcons } = await import('../../server/audio/render.js');
  const { tempCharacters } = await import('./helpers.js');
  const server = createBrainServer({
    dir: tempCharacters().dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
  });
  const port = await server.listen(0);
  const get = (/** @type {string} */ path, /** @type {string} */ host) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      const chunks = /** @type {Buffer[]} */ ([]);
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
  try {
    const here = await get('/preview/list.json', `localhost:${port}`);
    assert.equal(here.status, 200);
    assert.ok(JSON.parse(String(here.body)).pet.length > 0);

    const lan = await get('/preview/list.json', `192.168.1.20:${port}`);
    assert.equal(lan.status, 403);

    const climb = await get('/preview/pet/../../characters/x.json', `localhost:${port}`);
    assert.equal(climb.status, 404);
  } finally {
    await server.close();
  }
});

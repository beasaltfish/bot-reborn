import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import WebSocket from 'ws';
import { createDevPages } from '../../server/dev-pages.js';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { BODY_PATH } from '../../core/protocol.js';
import { tempCharacters } from './helpers.js';

/** @param {number} port @param {string} path @param {string} host */
function get(port, path, host) {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type']), body }));
    }).on('error', reject).end();
  });
}

/** @param {string} url @param {string} [protocol] */
function opens(url, protocol) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, protocol);
    ws.once('open', () => { ws.terminate(); resolve('open'); });
    ws.once('error', (err) => resolve(err.message));
  });
}

test('dev mode: Vite inside the brain, the same rules for the network', { timeout: 60_000 }, async () => {
  const server = createBrainServer({
    dir: tempCharacters().dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
    pages: (http) => createDevPages(http),
  });
  const port = await server.listen(0);
  const here = `localhost:${port}`;
  const lan = `192.168.1.20:${port}`;
  try {
    for (const p of ['/phone/', '/sim/', '/']) {
      const r = /** @type {any} */ (await get(port, p, here));
      assert.equal(r.status, 200, p);
      assert.match(r.body, /\/@vite\/client/, p);
    }
    const core = /** @type {any} */ (await get(port, '/core/protocol.js', here));
    assert.equal(core.status, 200);
    assert.match(core.type, /javascript/);
    assert.equal(/** @type {any} */ (await get(port, '/fixtures/check-en.wav', here)).status, 200);
    assert.notEqual(/** @type {any} */ (await get(port, '/core/fixtures/check-en.wav', here)).status, 200);

    // Everything the phone's page loads in dev mode, found by following its
    // imports from a LAN address.
    for (const p of ['/phone/', '/core/protocol.js', '/@vite/client', '/@react-refresh',
      '/node_modules/vite/dist/client/env.mjs', '/phone/audio/capture-worklet.js']) {
      assert.equal(/** @type {any} */ (await get(port, p, lan)).status, 200, p);
    }
    for (const p of ['/', '/sim/', '/sim/main.js', '/server/main.js', '/admin/src/main.tsx', '/core/fixtures/check-en.wav']) {
      assert.equal(/** @type {any} */ (await get(port, p, lan)).status, 403, p);
    }

    // Hot reload and the body link share the one port.
    const client = /** @type {any} */ (await get(port, '/@vite/client', here)).body;
    const token = /wsToken\s*=\s*"([^"]+)"/.exec(client)?.[1];
    assert.ok(token, 'the client names its HMR token');
    assert.equal(await opens(`ws://127.0.0.1:${port}/?token=${token}`, 'vite-hmr'), 'open');
    assert.equal(await opens(`ws://127.0.0.1:${port}${BODY_PATH}`), 'open');
  } finally {
    await server.close();
  }
});

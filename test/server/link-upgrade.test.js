import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { createLink } from '../../server/link.js';
import { BODY_PATH } from '../../core/protocol.js';

/** Open a socket and say whether it opened or why not. @param {string} url */
function opens(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('open', () => { ws.terminate(); resolve('open'); });
    ws.once('error', (err) => resolve(err.message));
  });
}

test('other upgrades on the same server are left alone', async () => {
  // In dev mode Vite's hot reload shares this server; the body link must not
  // answer its upgrades with a 400.
  const http = createServer();
  const link = createLink({ server: http, admit: () => 'token', onBody: () => {}, log: () => {} });
  /** @type {import('node:stream').Duplex[]} */ const raw = [];
  http.on('upgrade', (req, socket) => {
    if (req.url !== '/other') return;
    raw.push(socket);
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise((r) => http.listen(0, () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
  try {
    assert.equal(await opens(`ws://127.0.0.1:${port}/other`), 'open');
    assert.equal(await opens(`ws://127.0.0.1:${port}${BODY_PATH}`), 'open');
  } finally {
    link.close();
    for (const s of raw) s.destroy();
    http.closeAllConnections();
    http.close();
  }
});

test('an upgrade nobody takes is refused, not left hanging', async () => {
  // A socket handed to an upgrade listener outlives every HTTP timeout; left
  // alone, anything on the network could pile them up.
  const { createBrainServer } = await import('../../server/brain-server.js');
  const { renderEarcons } = await import('../../server/audio/render.js');
  const { tempCharacters } = await import('./helpers.js');
  const server = createBrainServer({
    dir: tempCharacters().dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
  });
  const port = await server.listen(0);
  try {
    const got = await Promise.race([
      opens(`ws://127.0.0.1:${port}/nope`),
      new Promise((r) => setTimeout(() => r('no answer'), 2000)),
    ]);
    assert.equal(got, 'Unexpected server response: 400');
  } finally {
    await server.close();
  }
});

test('a page server that throws is a 500, and the brain keeps serving', async () => {
  const { createBrainServer } = await import('../../server/brain-server.js');
  const { renderEarcons } = await import('../../server/audio/render.js');
  const { tempCharacters } = await import('./helpers.js');
  const server = createBrainServer({
    dir: tempCharacters().dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
    // As when npm run build empties dist/ under a running brain.
    pages: () => ({ serve: async () => { throw new Error('ENOENT'); }, close: async () => {} }),
  });
  const port = await server.listen(0);
  try {
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`http://127.0.0.1:${port}/phone/`)).status, 500);
  } finally {
    await server.close();
  }
});

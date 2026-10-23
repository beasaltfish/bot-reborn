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
